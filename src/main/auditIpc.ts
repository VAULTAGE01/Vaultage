import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { readVerifiedAuditLog, type AuditEventType } from './audit'
import { AUDIT_LOG_FILE } from './vaultStorage'
import { atomicWritePrivateFile } from './fileIO'
import { auditIpcContracts } from '../shared/auditIpcContracts'
import type { VaultSessionOperation } from './vaultSessionKey'

export interface AuditIpcDeps {
  hasVaultKey: () => boolean
  getAuditMacKey: () => Buffer | null
  beginSessionOperation: () => VaultSessionOperation | null
  flushAuditQueue: () => Promise<void>
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
}

export function registerAuditIpc(ipcMain: IpcMain, deps: AuditIpcDeps): void {
  const auditIpc = auditIpcContracts

  ipcMain.handle(auditIpc.read.channel, async (_, payload: unknown) => {
    auditIpc.read.validate(payload)
    if (!deps.hasVaultKey()) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    let macKey: Buffer | null = null
    try {
      macKey = deps.getAuditMacKey()
      await deps.flushAuditQueue()
      operation.assertCurrent()
      if (!macKey) throw new Error('Audit MAC key unavailable')
      const { events, verification } = await readVerifiedAuditLog(AUDIT_LOG_FILE, macKey)
      operation.assertCurrent()
      return { success: true, events, verification }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      macKey?.fill(0)
      operation.release()
    }
  })

  ipcMain.handle(auditIpc.exportJson.channel, async (event, payload: unknown) => {
    auditIpc.exportJson.validate(payload)
    if (!deps.hasVaultKey()) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    let macKey: Buffer | null = null
    try {
      macKey = deps.getAuditMacKey()
      await deps.flushAuditQueue()
      operation.assertCurrent()
      if (!macKey) throw new Error('Audit MAC key unavailable')
      const { events, verification, anchor } = await readVerifiedAuditLog(AUDIT_LOG_FILE, macKey)
      operation.assertCurrent()
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'Audit window is unavailable' }
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Vaultage Audit Log',
        defaultPath: 'vaultage-audit-log.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      operation.assertCurrent()
      if (result.canceled) return { success: false, cancelled: true }

      const filePath = result.filePath
      if (!filePath) throw new Error('Audit export path is unavailable')
      await atomicWritePrivateFile(filePath, JSON.stringify({
        exportedAt: new Date().toISOString(),
        verification,
        anchor,
        events,
      }, null, 2), { beforeCommit: operation.assertCurrent })

      // The private file has crossed its atomic durability boundary. Do not
      // turn that committed export into a reported failure if value-free audit
      // publication unexpectedly throws after the rename.
      try {
        deps.recordAudit('audit.exported', { filePath, count: events.length })
      } catch (err) {
        console.error('[audit] Could not enqueue committed audit export event:', err)
      }
      return { success: true, path: filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      macKey?.fill(0)
      operation.release()
    }
  })
}
