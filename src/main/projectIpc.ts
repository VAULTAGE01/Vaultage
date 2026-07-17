import { BrowserWindow, dialog, type IpcMain, type OpenDialogOptions, type WebContents } from 'electron'
import type { AuditEventType } from './audit'
import type { AuthController } from './auth'
import { resolveVaultEnvSelections, summarizeVaultEnvSelections } from './envSelections'
import { projectEnvFilePartialResult, writeProjectEnvFile } from './envFile'
import { discoverProjectCandidates, scanProject } from './projectScanner'
import {
  CREATE_PROJECT_GRANT_TARGET,
  existingProjectGrantTarget,
  ProjectPathCapabilityStore,
} from './projectCapabilities'
import { projectIpcContracts } from '../shared/projectIpcContracts'
import { projectExportDisplayText, resolveStoredProjectEnvExport } from '../shared/projectAccessPolicy'
import { vaultRevisionFrom } from './vaultIpcCommon'

export interface ProjectExportAuthorizationLease {
  assertCurrent(): void
}

export interface ProjectExportConfirmationSummary {
  projectName: string
  environmentName: string
  path: string
  mappings: readonly string[]
  addToGitignore: boolean
  overwriteExisting: boolean
}

export interface ProjectIpcDeps {
  getVaultKey: () => Buffer | null
  getVaultRevision: () => number
  readVault: (key: Buffer) => Promise<unknown>
  authController: AuthController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  authorizeProjectScan?: (vault: unknown, path: string, projectId?: string, replaceProjectId?: string) => Promise<void> | void
  acquireProjectExportLease: (
    vault: unknown,
    projectId: string,
  ) => Promise<ProjectExportAuthorizationLease>
  confirmProjectExportSummary: (summary: ProjectExportConfirmationSummary) => Promise<boolean>
  pathCapabilities: ProjectPathCapabilityStore
}

export function registerProjectIpc(ipcMain: IpcMain, deps: ProjectIpcDeps): void {
  const projectIpc = projectIpcContracts
  const capabilities = deps.pathCapabilities
  const trackedRenderers = new Set<number>()

  const trackRenderer = (webContents: WebContents) => {
    if (trackedRenderers.has(webContents.id)) return
    trackedRenderers.add(webContents.id)
    webContents.once('destroyed', () => {
      trackedRenderers.delete(webContents.id)
      capabilities.revokeRenderer(webContents.id)
    })
  }

  ipcMain.handle(projectIpc.pickFolder.channel, async (event, payload: unknown) => {
    const request = projectIpc.pickFolder.validate(payload)
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return null
    trackRenderer(event.sender)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Choose project folder',
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || deps.getVaultKey() !== vaultKey) return null
    return capabilities.grantFolder(
      event.sender.id,
      result.filePaths[0],
      request.purpose,
      request.projectId ? existingProjectGrantTarget(request.projectId) : CREATE_PROJECT_GRANT_TARGET,
    )
  })

  ipcMain.handle(projectIpc.pickProjectFiles.channel, async (event, payload: unknown) => {
    projectIpc.pickProjectFiles.validate(payload)
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return []
    trackRenderer(event.sender)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      title: 'Choose files to include in project scan',
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || deps.getVaultKey() !== vaultKey) return []
    return capabilities.grantFiles(event.sender.id, result.filePaths)
  })

  ipcMain.handle(projectIpc.scan.channel, async (event, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const payload = projectIpc.scan.validate(rawPayload)
      const path = await capabilities.requireProjectFolder(
        event.sender.id,
        payload.path,
        payload.projectId ? existingProjectGrantTarget(payload.projectId) : CREATE_PROJECT_GRANT_TARGET,
      )
      const manualFiles = await capabilities.requireFilesWithin(
        event.sender.id,
        path,
        payload.manualFiles ?? [],
      )
      const currentVault = await deps.readVault(vaultKey)
      if (deps.getVaultKey() !== vaultKey) return { success: false, error: 'Vaultage locked during project scan' }
      await deps.authorizeProjectScan?.(currentVault, path, payload.projectId, payload.replaceProjectId)
      const result = await scanProject({ path, manualFiles })
      if (deps.getVaultKey() !== vaultKey) return { success: false, error: 'Vaultage locked during project scan' }
      return { success: true, result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(projectIpc.discover.channel, async (event, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const payload = projectIpc.discover.validate(rawPayload)
      const parentPath = await capabilities.requireScanParent(event.sender.id, payload.parentPath)
      const result = await discoverProjectCandidates({ parentPath })
      if (deps.getVaultKey() !== vaultKey) return { success: false, error: 'Vaultage locked during project discovery' }
      for (const candidate of result.candidates) {
        capabilities.grantDiscoveredFolder(event.sender.id, parentPath, candidate.path)
      }
      return { success: true, result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(projectIpc.exportEnv.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const payload = projectIpc.exportEnv.validate(rawPayload)
      const currentVault = await deps.readVault(vaultKey)
      const authorizedVaultRevision = vaultRevisionFrom(currentVault, deps.getVaultRevision())
      if (deps.getVaultKey() !== vaultKey) return { success: false, error: 'Vaultage locked during project export' }
      if (deps.getVaultRevision() !== authorizedVaultRevision) {
        return { success: false, error: 'Vault changed during project export authorization; try again' }
      }
      const stored = resolveStoredProjectEnvExport(currentVault, payload.projectId, payload.environmentId)
      const commercialLease = await deps.acquireProjectExportLease(currentVault, payload.projectId)
      if (deps.getVaultKey() !== vaultKey) return { success: false, error: 'Vaultage locked during project export' }

      const mappings = summarizeVaultEnvSelections(currentVault, stored.selections)
      const confirmedSummary = await deps.confirmProjectExportSummary({
        projectName: stored.projectName,
        environmentName: stored.environmentName,
        path: projectExportDisplayText(stored.path, 'unavailable destination', 1024),
        mappings,
        addToGitignore: stored.addToGitignore,
        overwriteExisting: payload.overwriteExisting === true,
      })
      if (!confirmedSummary) return { success: false, cancelled: true, error: 'Project export cancelled' }
      commercialLease.assertCurrent()
      if (deps.getVaultKey() !== vaultKey || deps.getVaultRevision() !== authorizedVaultRevision) {
        return { success: false, error: 'Vault changed during project export confirmation; try again' }
      }

      const confirmation = deps.authController.confirmProjectEnvExport(
        `Approve .env export for ${stored.projectName} / ${stored.environmentName}`,
      )
      if (!confirmation.success) return confirmation

      const entries = resolveVaultEnvSelections(
        currentVault,
        stored.selections,
      )
      const { targetFolder, safeEntries, status } = await writeProjectEnvFile({
        projectPath: stored.path,
        entries,
        addToGitignore: stored.addToGitignore,
        overwriteExisting: payload?.overwriteExisting,
        invalidPathMessage: 'Invalid project folder',
        authorizeCommit: () => {
          commercialLease.assertCurrent()
          return deps.getVaultKey() === vaultKey
            && deps.getVaultRevision() === authorizedVaultRevision
        },
      })

      deps.recordAudit('env.exported', {
        targetFolder,
        projectId: stored.projectId,
        environmentId: stored.environmentId,
        envKeys: safeEntries.map(entry => entry.envKey),
        addToGitignore: stored.addToGitignore,
        envFileStatus: status,
      })
      return { success: true, status }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        error,
        requiresOverwriteConfirmation: error.includes('explicitly approve replacing it'),
        partial: projectEnvFilePartialResult(err),
      }
    }
  })
}
