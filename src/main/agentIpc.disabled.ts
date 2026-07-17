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
  confirmUserPresence?: (prompt: string) => { success: boolean; error?: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean }
  listAgentAccess?: () => Promise<{
    clients: Array<{ id: string; label: string; tokenFingerprint: string; generation: number; createdAt: string }>
    grants: Array<{
      id: string
      clientId: string
      project: { realPath: string }
      selections: Array<{ envKey: string }>
      delivery: 'response'
      createdAt: string
      expiresAt: string
    }>
  }>
  createAgentClient?: (label: string) => Promise<{
    client: { id: string; label: string; tokenFingerprint: string; generation: number; createdAt: string }
    token: string
  }>
  revokeAgentClient?: (clientId: string) => Promise<boolean>
  revokeAgentAutoApproval?: (grantId: string) => Promise<boolean>
}

export function registerAgentIpc(ipcMain: IpcMain, agentServer: AgentServerController, deps: AgentIpcDeps): void {
  void ipcMain
  void agentServer
  void deps
}

export function agentInstructionsSnippet(_token: string, _port: number, _scopedCredential = false): string {
  return ''
}
