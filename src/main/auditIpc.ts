import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { readVerifiedAuditLog, type AuditEventType } from './audit'
import { AUDIT_LOG_FILE } from './vaultStorage'
import { atomicWritePrivateFile } from './fileIO'
import { auditIpcContracts } from '../shared/auditIpcContracts'

export interface AuditIpcDeps {
  hasVaultKey: () => boolean
  getAuditMacKey: () => Buffer | null
  flushAuditQueue: () => Promise<void>
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
}

export function registerAuditIpc(ipcMain: IpcMain, deps: AuditIpcDeps): void {
  const auditIpc = auditIpcContracts

  ipcMain.handle(auditIpc.read.channel, async (_, payload: unknown) => {
    auditIpc.read.validate(payload)
    if (!deps.hasVaultKey()) return { success: false, error: 'Not authenticated' }
    const macKey = deps.getAuditMacKey()
    try {
      await deps.flushAuditQueue()
      if (!macKey) throw new Error('Audit MAC key unavailable')
      const { events, verification } = await readVerifiedAuditLog(AUDIT_LOG_FILE, macKey)
      return { success: true, events, verification }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      macKey?.fill(0)
    }
  })

  ipcMain.handle(auditIpc.exportJson.channel, async (_, payload: unknown) => {
    auditIpc.exportJson.validate(payload)
    if (!deps.hasVaultKey()) return { success: false, error: 'Not authenticated' }
    const macKey = deps.getAuditMacKey()
    try {
      await deps.flushAuditQueue()
      if (!macKey) throw new Error('Audit MAC key unavailable')
      const { events, verification, anchor } = await readVerifiedAuditLog(AUDIT_LOG_FILE, macKey)
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Export Vaultage Audit Log',
        defaultPath: 'vaultage-audit-log.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled) return { success: false, cancelled: true }

      await atomicWritePrivateFile(result.filePath!, JSON.stringify({
        exportedAt: new Date().toISOString(),
        verification,
        anchor,
        events,
      }, null, 2))
      deps.recordAudit('audit.exported', { filePath: result.filePath, count: events.length })
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      macKey?.fill(0)
    }
  })
}
