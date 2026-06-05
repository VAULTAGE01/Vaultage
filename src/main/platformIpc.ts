import { clipboard, shell, type IpcMain } from 'electron'
import { templateCsv } from '../shared/csvImportTemplate'
import { resolveAllowedExternalUrl } from './externalUrlPolicy'
import { submitProviderVote } from '#provider-vote'
import { setSecureInputEnabled } from './secureInput'

export function registerPlatformIpc(ipcMain: IpcMain): void {
  ipcMain.handle('security:set-secure-input', async (_, enabled: boolean) => {
    return setSecureInputEnabled(enabled === true)
  })

  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    const externalUrl = resolveAllowedExternalUrl(url)
    if (!externalUrl) return { success: false, error: 'External URL is not allowed' }
    try {
      await shell.openExternal(externalUrl)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('feedback:provider-vote', async (_, payload: unknown) => {
    try {
      await submitProviderVote(payload)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('import:copy-template', () => {
    try {
      clipboard.writeText(templateCsv())
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
