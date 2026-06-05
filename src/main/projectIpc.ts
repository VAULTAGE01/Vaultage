import { BrowserWindow, dialog, type IpcMain } from 'electron'
import type { AuditEventType } from './audit'
import type { AuthController } from './auth'
import { resolveVaultEnvSelections } from './envSelections'
import { writeProjectEnvFile } from './envFile'
import { scanProject } from './projectScanner'

export interface ProjectIpcDeps {
  getVaultKey: () => Buffer | null
  readVault: (key: Buffer) => Promise<unknown>
  authController: AuthController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
}

export function registerProjectIpc(ipcMain: IpcMain, deps: ProjectIpcDeps): void {
  ipcMain.handle('project:pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Choose project folder',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('project:pick-files', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      title: 'Choose files to include in project scan',
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('project:scan', async (_, payload: { path: string; manualFiles?: string[] }) => {
    try {
      return { success: true, result: await scanProject(payload) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('project:export-env', async (
    _,
    payload?: {
      path?: unknown
      selections?: unknown
      addToGitignore?: unknown
      plaintextConfirmation?: string
    },
  ) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const confirmation = deps.authController.confirmPlaintextExport(
        'Confirm plaintext .env export from Vaultage',
        payload?.plaintextConfirmation,
      )
      if (!confirmation.success) return confirmation

      const entries = resolveVaultEnvSelections(
        await deps.readVault(vaultKey),
        payload?.selections,
      )
      const { targetFolder, safeEntries } = await writeProjectEnvFile({
        projectPath: payload?.path,
        entries,
        addToGitignore: payload?.addToGitignore,
        invalidPathMessage: 'Invalid project folder',
      })

      deps.recordAudit('env.exported', {
        targetFolder,
        envKeys: safeEntries.map(entry => entry.envKey),
        addToGitignore: Boolean(payload?.addToGitignore),
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
