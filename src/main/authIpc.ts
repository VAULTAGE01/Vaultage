import {
  BrowserWindow,
  dialog,
  type IpcMain,
  type IpcMainInvokeEvent,
  type SaveDialogOptions,
} from 'electron'
import type { AuthController } from './auth'
import {
  AUTH_RECOVERY_PDF_SAVE_FAILED_MESSAGE,
  authIpcContracts,
} from '../shared/authIpcContracts'
import { atomicWritePrivateFile } from './fileIO'
import { buildRecoveryKitPdf } from './recoveryKitPdf'
import { safeDiagnosticErrorCode } from './errorDiagnostics'

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
  ipcMain.handle(authIpc.recoveryStatus.channel, async (_, payload: unknown) => {
    authIpc.recoveryStatus.validate(payload)
    return authController.recoveryStatus()
  })
  ipcMain.handle(authIpc.createRecoveryKit.channel, async (_, payload: unknown) => {
    return authController.createOrRotateRecoveryKit(authIpc.createRecoveryKit.validate(payload))
  })
  ipcMain.handle(authIpc.verifyRecoveryKit.channel, async (_, payload: unknown) => {
    const validated = authIpc.verifyRecoveryKit.validate(payload)
    return authController.verifyRecoveryKit(validated.recoveryCode)
  })
  ipcMain.handle(authIpc.saveRecoveryKitPdf.channel, async (event, payload: unknown) => {
    const validated = authIpc.saveRecoveryKitPdf.validate(payload)
    try {
      const material = await authController.recoveryMaterialForPdf(validated.recoveryCode)
      if (!material.success || !material.data) return material
      const result = await showSaveDialogForSender(event, {
        title: 'Save Vaultage Emergency Kit',
        defaultPath: `Vaultage-Emergency-Kit-${material.data.vaultFingerprint}.pdf`,
        filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return { success: false, cancelled: true }
      const destination = result.filePath.toLowerCase().endsWith('.pdf')
        ? result.filePath
        : `${result.filePath}.pdf`
      await atomicWritePrivateFile(destination, buildRecoveryKitPdf(material.data))
      return { success: true, path: destination }
    } catch (err) {
      console.error('[vault-auth] Emergency Kit PDF save failed', {
        code: safeDiagnosticErrorCode(err),
      })
      return {
        success: false,
        errorCode: 'recovery_pdf_save_failed',
        error: AUTH_RECOVERY_PDF_SAVE_FAILED_MESSAGE,
      }
    }
  })
  ipcMain.handle(authIpc.revokeRecoveryKit.channel, async (_, payload: unknown) => {
    return authController.revokeRecoveryKit(authIpc.revokeRecoveryKit.validate(payload))
  })
  ipcMain.handle(authIpc.recoverWithKit.channel, async (_, payload: unknown) => {
    return authController.recoverWithKit(authIpc.recoverWithKit.validate(payload))
  })
}

function showSaveDialogForSender(
  event: IpcMainInvokeEvent,
  options: SaveDialogOptions,
) {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}
