import type { AuditEventType } from './audit'
import type { AppMode } from './security'

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
  getAuthToken: () => string | null
  getWindow: () => AgentServerWindow | null
  confirmUserPresence: (prompt: string, phrase?: string) => UserPresenceResult
  resolveReleaseSelections: (selections: unknown) => Promise<unknown[]> | unknown[]
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
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

  configuredPort(): number {
    return this.port
  }

  setApiEnabledState(enabled: boolean): void {
    void enabled
  }

  cancelPendingRequests(reason: string): void {
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

  async start(): Promise<void> {}

  async stop(): Promise<void> {}
}
