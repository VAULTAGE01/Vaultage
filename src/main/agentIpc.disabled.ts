import type { IpcMain } from 'electron'
import type { AuditEventType } from './audit'
import type { AgentServerController } from '#agent-server'

export interface AgentIpcDeps {
  hasVaultKey: () => boolean
  getAgentApiToken: () => Promise<string>
  syncDiscovery?: (port: number) => Promise<void>
  recordAudit?: (type: AuditEventType, details?: Record<string, unknown>) => void
  authorizeCapability?: (capability: 'pro.agent' | 'pro.services' | 'pro.extension') => Promise<void | { assertCurrent(): void }>
  verifyExtensionNativeHost?: () => Promise<void>
}

export function registerAgentIpc(ipcMain: IpcMain, agentServer: AgentServerController, deps: AgentIpcDeps): void {
  void ipcMain
  void agentServer
  void deps
}

export function agentInstructionsSnippet(_token: string, _port: number): string {
  return ''
}
