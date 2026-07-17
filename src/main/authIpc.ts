import type { IpcMain } from 'electron'
import type { AuthController } from './auth'
import { authIpcContracts } from '../shared/authIpcContracts'

export function registerAuthIpc(ipcMain: IpcMain, authController: AuthController): void {
  const authIpc = authIpcContracts

  ipcMain.handle(authIpc.status.channel, async (_, payload: unknown) => {
    authIpc.status.validate(payload)
    return authController.status()
  })
  ipcMain.handle(authIpc.setup.channel, async (_, payload: unknown) => {
    return authController.setup(authIpc.setup.validate(payload))
  })
  ipcMain.handle(authIpc.touchID.channel, async (_, payload: unknown) => {
    authIpc.touchID.validate(payload)
    return authController.unlockWithTouchID()
  })
  ipcMain.handle(authIpc.confirm.channel, async (_, payload: unknown) => {
    const opts = authIpc.confirm.validate(payload)
    const prompt = opts.prompt ?? 'Confirm action'
    return authController.confirmUnlockedKeychain(prompt)
  })
  ipcMain.handle(authIpc.password.channel, async (_, payload: unknown) => {
    return authController.unlockWithPassword(authIpc.password.validate(payload))
  })
  ipcMain.handle(authIpc.changePassword.channel, async (_, payload: unknown) => {
    return authController.changePassword(authIpc.changePassword.validate(payload))
  })
}
