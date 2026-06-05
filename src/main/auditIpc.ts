import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { promises as fs } from 'fs'
import { readAuditLog, verifyAuditChain, type AuditEventType } from './audit'
import { AUDIT_LOG_FILE } from './vaultStorage'

export interface AuditIpcDeps {
  hasVaultKey: () => boolean
  getAuditMacKey: () => Buffer | null
  flushAuditQueue: () => Promise<void>
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
}

export function registerAuditIpc(ipcMain: IpcMain, deps: AuditIpcDeps): void {
  ipcMain.handle('audit:read', async () => {
    if (!deps.hasVaultKey()) return { success: false, error: 'Not authenticated' }
    const macKey = deps.getAuditMacKey()
    try {
      await deps.flushAuditQueue()
      const events = await readAuditLog(AUDIT_LOG_FILE)
      const verification = verifyAuditChain(events, { macKey: macKey ?? undefined, requireMac: true })
      return { success: true, events, verification }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      macKey?.fill(0)
    }
  })

  ipcMain.handle('audit:export-json', async () => {
    if (!deps.hasVaultKey()) return { success: false, error: 'Not authenticated' }
    const macKey = deps.getAuditMacKey()
    try {
      await deps.flushAuditQueue()
      const events = await readAuditLog(AUDIT_LOG_FILE)
      const verification = verifyAuditChain(events, { macKey: macKey ?? undefined, requireMac: true })
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Export Vaultage Audit Log',
        defaultPath: 'vaultage-audit-log.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled) return { success: false, cancelled: true }

      await fs.writeFile(result.filePath!, JSON.stringify({
        exportedAt: new Date().toISOString(),
        verification,
        events,
      }, null, 2), 'utf8')
      deps.recordAudit('audit.exported', { filePath: result.filePath, count: events.length })
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      macKey?.fill(0)
    }
  })
}
