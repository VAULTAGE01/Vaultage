import type { IpcMain } from 'electron'
import type { AuthController } from './auth'

export function registerAuthIpc(ipcMain: IpcMain, authController: AuthController): void {
  ipcMain.handle('auth:status', async () => authController.status())
  ipcMain.handle('auth:setup', async (_, password: unknown) => authController.setup(password))
  ipcMain.handle('auth:touchid', async () => authController.unlockWithTouchID())
  ipcMain.handle('auth:confirm', async (_, opts?: { prompt?: string }) => {
    const prompt = opts?.prompt ?? 'Confirm action'
    return authController.confirmUnlockedKeychain(prompt)
  })
  ipcMain.handle('auth:password', async (_, password: unknown) => authController.unlockWithPassword(password))
  ipcMain.handle('auth:change-password', async (_, payload?: { current?: unknown; next?: unknown }) => {
    return authController.changePassword(payload)
  })
}
