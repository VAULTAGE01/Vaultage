import type { AuditEventType } from './audit'
import type { AppMode } from './security'
import type { writeProjectEnvFile } from './envFile'
type ProCapability = 'pro.agent' | 'pro.services' | 'pro.extension' | 'cloud.oauth' | 'cloud.sync' | 'cloud.audit' | 'cloud.spend'

export const DEFAULT_SERVER_PORT = 43777
export const SERVER_PORT = DEFAULT_SERVER_PORT

export function validateAgentApiPort(value: unknown): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535')
  }
  return port
}

type UserPresenceResult =
  | { success: true }
  | { success: false; error: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean }

export interface ExtensionSaveCandidateSave {
  requestId: string
  name: string
  envKey: string
  value: string
  requestor: string
  provider?: string
  providerLabel?: string
  origin?: string
  host?: string
  path?: string
  title?: string
  receivedAt: string
}

export interface AgentServerWindow {
  webContents: {
    send(channel: string, ...args: unknown[]): void
  }
  setContentProtection(enabled: boolean): void
  isFocused(): boolean
  show(): void
}

export interface AgentServerControllerDeps {
  getMode: () => AppMode
  hasVaultKey: () => boolean
  shouldProtectContent?: () => boolean
  onStateChanged?: () => void
  publishDiscovery?: (port: number, listenerId: string, startedAt: string) => Promise<void>
  removeDiscovery?: () => Promise<void>
  getAuthToken: () => string | null
  getWindow: () => AgentServerWindow | null
  confirmUserPresence: (prompt: string, phrase?: string) => UserPresenceResult
  resolveReleaseSelections: (selections: unknown) => Promise<unknown[]> | unknown[]
  saveExtensionCandidate?: (
    candidate: Readonly<ExtensionSaveCandidateSave>,
    signal: AbortSignal,
    authorizeCommit?: () => void,
  ) => Promise<{ secretId?: string }> | { secretId?: string }
  writeProjectEnvFile?: typeof writeProjectEnvFile
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  authorizeCapability?: (capability: ProCapability) => Promise<void | { assertCurrent(): void }>
  host?: string
  port?: number
  requestTimeoutMs?: number
}

export class AgentServerController {
  private port = DEFAULT_SERVER_PORT

  constructor(options: AgentServerControllerDeps) {
    void options
  }

  pendingCount(): number {
    return 0
  }

  isApiEnabled(): boolean {
    return false
  }

  isExtensionEnabled(): boolean {
    return false
  }

  isListening(): boolean {
    return false
  }

  configuredPort(): number {
    return this.port
  }

  setApiEnabledState(enabled: boolean): void {
    void enabled
  }

  setExtensionEnabledState(enabled: boolean): void {
    void enabled
  }

  handleSetApiEnabled(enabled: boolean): { success: boolean; error?: string } {
    return enabled
      ? { success: false, error: 'Agent API is unavailable in this build' }
      : { success: true }
  }

  handleSetExtensionEnabled(enabled: boolean): { success: boolean; error?: string } {
    return enabled
      ? { success: false, error: 'Browser extension bridge is unavailable in this build' }
      : { success: true }
  }

  cancelPendingRequests(reason: string): void {
    void reason
  }

  cancelPendingAgentRequests(reason: string): void {
    void reason
  }

  async configurePort(value: unknown): Promise<{ success: boolean; error?: string }> {
    try {
      this.port = validateAgentApiPort(value)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async start(_capability: 'pro.agent' | 'pro.extension' = 'pro.agent'): Promise<void> {}

  async stop(): Promise<void> {}

  async syncListenerState(): Promise<void> {}
  async handleCapabilitiesLost(_capabilities: readonly ProCapability[]): Promise<void> {}
}
