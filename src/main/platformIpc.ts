import { clipboard, shell, type IpcMain } from 'electron'
import { templateCsv } from '../shared/csvImportTemplate'
import { resolveAllowedExternalUrl } from './externalUrlPolicy'
import { submitProviderVote } from '#provider-vote'
import { setSecureInputEnabled } from './secureInput'
import { platformIpcContracts } from '../shared/platformIpcContracts'

export function registerPlatformIpc(ipcMain: IpcMain): void {
  const platformIpc = platformIpcContracts

  ipcMain.handle(platformIpc.setSecureInputEnabled.channel, async (_, rawPayload: unknown) => {
    const enabled = platformIpc.setSecureInputEnabled.validate(rawPayload)
    return setSecureInputEnabled(enabled === true)
  })

  ipcMain.handle(platformIpc.openExternal.channel, async (_, rawPayload: unknown) => {
    const url = platformIpc.openExternal.validate(rawPayload)
    const externalUrl = resolveAllowedExternalUrl(url)
    if (!externalUrl) return { success: false, error: 'External URL is not allowed' }
    try {
      await shell.openExternal(externalUrl)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(platformIpc.providerVote.channel, async (_, rawPayload: unknown) => {
    try {
      const payload = platformIpc.providerVote.validate(rawPayload)
      await submitProviderVote(payload)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(platformIpc.copyImportTemplate.channel, (_, rawPayload: unknown) => {
    platformIpc.copyImportTemplate.validate(rawPayload)
    try {
      clipboard.writeText(templateCsv())
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
