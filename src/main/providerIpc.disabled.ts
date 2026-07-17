import type { IpcMain } from 'electron'
import type { AuditEventType } from './audit'

export function registerProviderIpc(
  ipcMain: IpcMain,
  client: unknown,
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void,
  deps: unknown,
): {
  clearSessionAuthorizations(): void
  authorizeVerificationMutation(
    currentVault: unknown,
    command: Record<string, unknown>,
    context: { sessionEpoch: number; webContentsId: number },
  ): Record<string, unknown>
} {
  void ipcMain
  void client
  void recordAudit
  void deps
  return {
    clearSessionAuthorizations: () => undefined,
    authorizeVerificationMutation: (_currentVault, command) => {
      const type = typeof command.type === 'string' ? command.type : ''
      if (
        type === 'secret.provider-link.set' ||
        type.startsWith('provider.') ||
        type.startsWith('provider-group.')
      ) {
        throw new Error('Provider integrations are unavailable in this edition')
      }
      if (containsClosedProviderMetadata(command)) {
        throw new Error('Provider-owned metadata cannot be changed in this edition')
      }
      return command
    },
  }
}

const closedProviderKeys = new Set([
  'providerLink',
  'providerId',
  'providerEnvName',
  'syncRule',
])

function containsClosedProviderMetadata(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => containsClosedProviderMetadata(item, seen))

  const record = value as Record<string, unknown>
  if (record.kind === 'cloud') return true
  for (const [key, nested] of Object.entries(record)) {
    if (closedProviderKeys.has(key) && nested !== undefined) return true
    if (containsClosedProviderMetadata(nested, seen)) return true
  }
  return false
}
