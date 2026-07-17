import type { Buffer } from 'buffer'
import type { AuditEventType } from './audit'
import type { AuthController } from './auth'
import type { VaultSessionOperation } from './vaultSessionKey'
import type { VaultMutationCommand } from '../shared/vaultIpcContracts'

export interface VaultIpcDeps {
  getVaultKey: () => Buffer | null
  readVault: (key: Buffer) => Promise<unknown>
  beginSessionOperation: () => VaultSessionOperation | null
  recordSecretUsage: (secretId: string, usedAt?: string) => void
  decorateVaultSnapshot: (snapshot: unknown) => unknown
  getVaultRevision: () => number
  setVaultRevision: (revision: number) => void
  /**
   * Main-process authorization hook for provider semantic mutations. Called
   * only after revision preconditions pass and before mutation application.
   */
  authorizeProviderMutation?: (
    currentVault: unknown,
    command: Record<string, unknown>,
    context: { sessionEpoch: number; webContentsId: number },
  ) => Record<string, unknown>
  /** Closed-edition commercial policy, resolved inside the serialized commit. */
  authorizeCommercialMutation?: (
    currentVault: unknown,
    command: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>
  /** Main-owned authorization for newly persisted local Project paths. */
  authorizeProjectPathMutation: (
    currentVault: unknown,
    command: VaultMutationCommand,
    context: { webContentsId: number },
  ) => VaultMutationCommand | Promise<VaultMutationCommand>
  onVaultChanged?: (change: { revision: number; data: unknown; source?: string }) => void
  lockVault: (notifyRenderer?: boolean, reason?: string) => void | Promise<void>
  authController: AuthController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  quitApp?: () => void
}

export class StaleVaultMutationError extends Error {
  constructor(
    readonly currentRevision: number,
    readonly currentSnapshot?: unknown,
  ) {
    super('Vault revision is stale')
  }
}

export function vaultRevisionFrom(vault: unknown, fallback: number): number {
  if (vault && typeof vault === 'object' && !Array.isArray(vault)) {
    const revision = (vault as { revision?: unknown }).revision
    if (typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
      return revision
    }
  }
  return fallback > 0 ? fallback : 1
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value }
}
