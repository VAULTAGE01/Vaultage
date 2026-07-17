import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { promises as fs } from 'fs'
import {
  createVaultBackupSnapshot,
  readVaultBackupSnapshot,
} from './vaultStorage'
import { vaultIpcContracts } from '../shared/vaultIpcContracts'
import type { VaultIpcDeps } from './vaultIpcCommon'

export function registerVaultSessionIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  const vaultIpc = vaultIpcContracts

  ipcMain.handle(vaultIpc.lock.channel, async (_, payload: unknown) => {
    vaultIpc.lock.validate(payload)
    await deps.lockVault(false, 'manual')
    return { success: true }
  })

  ipcMain.handle(vaultIpc.signOut.channel, async (_, payload: unknown) => {
    vaultIpc.signOut.validate(payload)
    const forgetResult = deps.authController.forgetTouchID()
    if (!forgetResult.success && !forgetResult.notFound) return forgetResult
    await deps.lockVault(false, 'sign-out')
    deps.quitApp?.()
    return { success: true }
  })

  ipcMain.handle(vaultIpc.backup.channel, async (_, payload: unknown) => {
    vaultIpc.backup.validate(payload)
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Choose backup destination',
    })
    if (result.canceled) return { success: false, cancelled: true }

    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }

    let stagingDir: string | null = null
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const backupDir = join(result.filePaths[0], `vault-backup-${stamp}`)
      stagingDir = join(
        result.filePaths[0],
        `.vault-backup-${stamp}.${randomUUID()}.tmp`,
      )
      await createVaultBackupSnapshot(stagingDir, vaultKey)
      await fs.rename(stagingDir, backupDir)
      stagingDir = null
      deps.recordAudit('vault.backup.created', { format: 'vaultage.backup.v1' })
      return { success: true, path: backupDir }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle(vaultIpc.restoreBackup.channel, async (_, rawPayload: unknown) => {
    let payload: ReturnType<typeof vaultIpc.restoreBackup.validate>
    try {
      payload = vaultIpc.restoreBackup.validate(rawPayload)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Choose a Vaultage backup folder to restore',
    })
    if (result.canceled) return { success: false, cancelled: true }

    try {
      const snapshot = await readVaultBackupSnapshot(result.filePaths[0])
      const restored = await deps.authController.restoreBackup(snapshot, payload)
      if (!restored.success) return restored
      deps.recordAudit('vault.backup.restored', { sameVault: true })
      await deps.lockVault(false, 'backup-restore')
      deps.quitApp?.()
      return {
        success: true,
        path: result.filePaths[0],
        restartRequired: true,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
