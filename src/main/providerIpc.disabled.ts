import type { IpcMain } from 'electron'
import type { AuditEventType } from './audit'

export function registerProviderIpc(
  ipcMain: IpcMain,
  client: unknown,
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void,
  deps: unknown,
): void {
  void ipcMain
  void client
  void recordAudit
  void deps
}
