import type { IpcMain } from 'electron'
import type { AuditEventType } from './audit'

export function createRailwayProviderRuntime(
  _client?: unknown,
  _openExternal?: unknown,
): undefined {
  return undefined
}

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
      if (type === 'folder.import') {
        return stripClosedProviderMetadata(command) as Record<string, unknown>
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
  'providerBinding',
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

function stripClosedProviderMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(item => stripClosedProviderMetadata(item))
      .filter(item => item !== OMIT_CLOSED_PROVIDER_VALUE)
  }
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  if (source.kind === 'cloud') return OMIT_CLOSED_PROVIDER_VALUE

  const sanitized: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(source)) {
    if (closedProviderKeys.has(key)) continue
    const next = stripClosedProviderMetadata(nested)
    if (next !== OMIT_CLOSED_PROVIDER_VALUE) sanitized[key] = next
  }
  return sanitized
}

const OMIT_CLOSED_PROVIDER_VALUE = Symbol('omit-closed-provider-value')
