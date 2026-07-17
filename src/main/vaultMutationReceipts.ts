import { createHash } from 'crypto'
import { VAULT_MUTATION_TYPES, type VaultMutationType } from '../shared/vaultIpcContracts'
import type { AuditEvent, AuditEventType } from './audit'
import type { VaultCrudAuditEntry } from './vaultCrudAudit'

export const MAX_RECENT_MUTATION_RECEIPTS = 16
export const MAX_MUTATION_RECEIPT_AUDIT_ENTRIES = 16
export const MAX_MUTATION_RECEIPT_ENTITY_IDS = 20
export const MAX_MUTATION_RECEIPT_RESULT_IDS = 256

const INTERNAL_STATE_KEY = '_vaultage'
const MUTATION_RECEIPTS_KEY = 'recentMutationReceipts'
const ENTITY_KINDS = new Set([
  'folder',
  'secret',
  'env-project',
  'provider-config',
  'provider-group',
])
const CRUD_AUDIT_TYPES = new Set<AuditEventType>([
  'vault.folder.created',
  'vault.folder.updated',
  'vault.folder.deleted',
  'vault.secret.created',
  'vault.secret.updated',
  'vault.secret.deleted',
  'vault.env_project.created',
  'vault.env_project.updated',
  'vault.env_project.deleted',
  'vault.provider_config.created',
  'vault.provider_config.updated',
  'vault.provider_config.deleted',
  'vault.provider_group.created',
  'vault.provider_group.updated',
  'vault.provider_group.deleted',
  'vault.preferences.updated',
])
const MUTATION_TYPES = new Set<string>(VAULT_MUTATION_TYPES)
const SHA256_RE = /^[0-9a-f]{64}$/

export interface VaultMutationReceiptAuditEntry {
  type: AuditEventType
  entityKind?: string
  count?: number
  vaultItemIds?: string[]
  omittedCount?: number
}

export interface VaultMutationReceipt {
  id: string
  revision: number
  commandType: VaultMutationType
  commandFingerprint: string
  commandResult?: Record<string, unknown>
  audit: VaultMutationReceiptAuditEntry[]
}

export interface CreateVaultMutationReceipt {
  id: string
  revision: number
  commandType: VaultMutationType
  commandFingerprint: string
  commandResult?: unknown
  auditEntries: readonly VaultCrudAuditEntry[]
}

/** Add a bounded, plaintext-value-free semantic commit receipt to the vault. */
export function withVaultMutationReceipt(
  vault: Record<string, unknown>,
  input: CreateVaultMutationReceipt,
): { vault: Record<string, unknown>; receipt: VaultMutationReceipt } {
  const receipt = createReceipt(input)
  const internal = isRecord(vault[INTERNAL_STATE_KEY]) ? vault[INTERNAL_STATE_KEY] : {}
  const receipts = [
    ...readReceipts(vault).filter(candidate => candidate.id !== receipt.id),
    receipt,
  ].slice(-MAX_RECENT_MUTATION_RECEIPTS)
  return {
    vault: {
      ...vault,
      [INTERNAL_STATE_KEY]: {
        ...internal,
        [MUTATION_RECEIPTS_KEY]: receipts,
      },
    },
    receipt,
  }
}

/** Find a previously committed semantic mutation without exposing `_vaultage`. */
export function findVaultMutationReceipt(
  vault: unknown,
  mutationId: string,
  commandFingerprint: string,
): VaultMutationReceipt | null {
  validateMutationId(mutationId)
  validateCommandFingerprint(commandFingerprint)
  if (!isRecord(vault)) return null
  const receipts = readReceipts(vault)
  const receipt = receipts.findLast(candidate => candidate.id === mutationId) ?? null
  if (receipt && receipt.commandFingerprint !== commandFingerprint) {
    throw new Error('Vault mutation id was already used for a different command')
  }
  return receipt
}

/** Stable SHA-256 binding for a validated semantic command. */
export function fingerprintVaultMutationCommand(command: unknown): string {
  return createHash('sha256').update(canonicalJson(command)).digest('hex')
}

/**
 * Rebuild audit work from a durable receipt. `mutationId` is intentionally
 * included in every event so a verifier can reconcile or deduplicate a retry
 * across process restarts without retaining any secret values.
 */
export function auditEntriesFromVaultMutationReceipt(
  receipt: VaultMutationReceipt,
): VaultCrudAuditEntry[] {
  return receipt.audit.map((entry, receiptAuditIndex) => ({
    type: entry.type,
    details: {
      revision: receipt.revision,
      mutationId: receipt.id,
      receiptAuditIndex,
      ...(entry.entityKind === undefined ? {} : { entityKind: entry.entityKind }),
      ...(entry.count === undefined ? {} : { count: entry.count }),
      ...(entry.vaultItemIds === undefined ? {} : { vaultItemIds: [...entry.vaultItemIds] }),
      ...(entry.omittedCount === undefined ? {} : { omittedCount: entry.omittedCount }),
    },
  }))
}

/** Return every valid bounded receipt without exposing any vault values. */
export function listVaultMutationReceipts(vault: unknown): VaultMutationReceipt[] {
  return isRecord(vault) ? readReceipts(vault) : []
}

/**
 * Rebuild only audit entries that are absent from the authenticated retained
 * history. This closes the crash window between ciphertext rename and audit
 * append without duplicating already-published receipt entries.
 */
export function pendingAuditEntriesFromVaultMutationReceipts(
  vault: unknown,
  auditEvents: readonly AuditEvent[],
): VaultCrudAuditEntry[] {
  const published = new Set<string>()
  const legacyPublished = new Set<string>()
  for (const event of auditEvents) {
    const mutationId = event.details.mutationId
    if (typeof mutationId !== 'string') continue
    const index = event.details.receiptAuditIndex
    if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) {
      published.add(`${mutationId}:${index}`)
    } else {
      // Events written before indexed reconciliation were published as one
      // synchronous batch. Treat them as complete to avoid duplicate history.
      legacyPublished.add(mutationId)
    }
  }

  return listVaultMutationReceipts(vault).flatMap((receipt) => {
    if (legacyPublished.has(receipt.id)) return []
    return auditEntriesFromVaultMutationReceipt(receipt)
      .filter(entry => {
        const index = entry.details?.receiptAuditIndex
        return typeof index === 'number' && !published.has(`${receipt.id}:${index}`)
      })
  })
}

function createReceipt(input: CreateVaultMutationReceipt): VaultMutationReceipt {
  validateMutationId(input.id)
  validateRevision(input.revision)
  if (!MUTATION_TYPES.has(input.commandType)) throw new Error('Invalid vault mutation receipt command type')
  validateCommandFingerprint(input.commandFingerprint)
  if (input.auditEntries.length > MAX_MUTATION_RECEIPT_AUDIT_ENTRIES) {
    throw new Error('Vault mutation receipt contains too many audit entries')
  }
  const commandResult = sanitiseCommandResult(input.commandType, input.commandResult)
  return {
    id: input.id,
    revision: input.revision,
    commandType: input.commandType,
    commandFingerprint: input.commandFingerprint,
    ...(commandResult === undefined ? {} : { commandResult }),
    audit: input.auditEntries.map(sanitiseAuditEntry),
  }
}

function readReceipts(vault: Record<string, unknown>): VaultMutationReceipt[] {
  const internal = isRecord(vault[INTERNAL_STATE_KEY]) ? vault[INTERNAL_STATE_KEY] : null
  const raw = internal?.[MUTATION_RECEIPTS_KEY]
  if (!Array.isArray(raw)) return []
  const parsed: VaultMutationReceipt[] = []
  for (const value of raw.slice(-MAX_RECENT_MUTATION_RECEIPTS)) {
    const receipt = parseReceipt(value)
    if (receipt) parsed.push(receipt)
  }
  return parsed
}

function parseReceipt(value: unknown): VaultMutationReceipt | null {
  if (!isRecord(value)) return null
  const { id, revision, commandType, commandFingerprint, audit } = value
  if (typeof id !== 'string' || !isSafeId(id)) return null
  if (!isPositiveSafeInteger(revision)) return null
  if (typeof commandType !== 'string' || !MUTATION_TYPES.has(commandType)) return null
  if (typeof commandFingerprint !== 'string' || !SHA256_RE.test(commandFingerprint)) return null
  if (!Array.isArray(audit) || audit.length > MAX_MUTATION_RECEIPT_AUDIT_ENTRIES) return null
  const parsedAudit: VaultMutationReceiptAuditEntry[] = []
  for (const entry of audit) {
    const parsed = parseAuditEntry(entry)
    if (!parsed) return null
    parsedAudit.push(parsed)
  }
  const parsedResult = sanitiseCommandResult(commandType as VaultMutationType, value.commandResult)
  return {
    id,
    revision,
    commandType: commandType as VaultMutationType,
    commandFingerprint,
    ...(parsedResult === undefined ? {} : { commandResult: parsedResult }),
    audit: parsedAudit,
  }
}

function sanitiseAuditEntry(entry: VaultCrudAuditEntry): VaultMutationReceiptAuditEntry {
  if (!CRUD_AUDIT_TYPES.has(entry.type)) throw new Error('Unsupported vault mutation receipt audit type')
  const details = isRecord(entry.details) ? entry.details : {}
  const result: VaultMutationReceiptAuditEntry = { type: entry.type }
  if (entry.type === 'vault.preferences.updated') return result

  if (typeof details.entityKind !== 'string' || !ENTITY_KINDS.has(details.entityKind)) {
    throw new Error('Invalid vault mutation receipt entity kind')
  }
  const count = positiveOrZeroInteger(details.count, 'vault mutation receipt entity count')
  const originalIds = Array.isArray(details.vaultItemIds) ? details.vaultItemIds : []
  const ids = originalIds.slice(0, MAX_MUTATION_RECEIPT_ENTITY_IDS).map((value) => {
    if (typeof value !== 'string' || !isSafeId(value)) throw new Error('Invalid vault mutation receipt entity id')
    return value
  })
  const sourceOmitted = positiveOrZeroInteger(details.omittedCount ?? 0, 'vault mutation receipt omitted count')
  const omittedCount = Math.max(sourceOmitted + Math.max(0, originalIds.length - ids.length), count - ids.length)
  return {
    type: entry.type,
    entityKind: details.entityKind,
    count,
    vaultItemIds: ids,
    omittedCount,
  }
}

function parseAuditEntry(value: unknown): VaultMutationReceiptAuditEntry | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !CRUD_AUDIT_TYPES.has(value.type as AuditEventType)) {
    return null
  }
  const type = value.type as AuditEventType
  if (type === 'vault.preferences.updated') return { type }
  if (typeof value.entityKind !== 'string' || !ENTITY_KINDS.has(value.entityKind)) return null
  if (!isNonNegativeSafeInteger(value.count) || !isNonNegativeSafeInteger(value.omittedCount)) return null
  if (!Array.isArray(value.vaultItemIds) || value.vaultItemIds.length > MAX_MUTATION_RECEIPT_ENTITY_IDS) return null
  if (!value.vaultItemIds.every(id => typeof id === 'string' && isSafeId(id))) return null
  return {
    type,
    entityKind: value.entityKind,
    count: value.count,
    vaultItemIds: [...value.vaultItemIds] as string[],
    omittedCount: value.omittedCount,
  }
}

function sanitiseCommandResult(
  commandType: VaultMutationType,
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  switch (commandType) {
    case 'folder.delete':
      return { rootId: requiredSafeId(value.rootId, 'root folder id') }
    case 'folder.duplicate':
    case 'folder.import':
      return {
        folderId: requiredSafeId(value.folderId, 'folder id'),
        firstSecretId: value.firstSecretId === null
          ? null
          : requiredSafeId(value.firstSecretId, 'first secret id'),
        secretCount: positiveOrZeroInteger(value.secretCount, 'secret count'),
      }
    case 'folder.move-item': {
      const result: Record<string, unknown> = {}
      if (value.selectedFolderId !== undefined) {
        result.selectedFolderId = requiredSafeId(value.selectedFolderId, 'selected folder id')
      }
      if (value.selectedSecretId !== undefined) {
        result.selectedSecretId = requiredSafeId(value.selectedSecretId, 'selected secret id')
      }
      return result
    }
    case 'secret.create-many':
    case 'secret.create-many-and-map': {
      if (!Array.isArray(value.createdIds)) return undefined
      const createdIds = value.createdIds.slice(0, MAX_MUTATION_RECEIPT_RESULT_IDS)
        .map(id => requiredSafeId(id, 'created secret id'))
      const createdIdCount = value.createdIdCount === undefined
        ? value.createdIds.length
        : positiveOrZeroInteger(value.createdIdCount, 'created secret id count')
      if (createdIdCount < createdIds.length) throw new Error('Invalid created secret id count')
      return { createdIds, createdIdCount }
    }
    default:
      return undefined
  }
}

function requiredSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSafeId(value)) throw new Error(`Invalid ${label}`)
  return value
}

function isSafeId(value: string): boolean {
  return value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value)
}

function validateMutationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isSafeId(value)) throw new Error('Invalid vault mutation id')
}

function validateCommandFingerprint(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new Error('Invalid vault mutation command fingerprint')
  }
}

function validateRevision(value: unknown): asserts value is number {
  if (!isPositiveSafeInteger(value)) throw new Error('Invalid vault mutation receipt revision')
}

function positiveOrZeroInteger(value: unknown, label: string): number {
  if (!isNonNegativeSafeInteger(value)) throw new Error(`Invalid ${label}`)
  return value
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const visit = (candidate: unknown): string | undefined => {
    if (candidate === null) return 'null'
    switch (typeof candidate) {
      case 'string':
      case 'boolean':
        return JSON.stringify(candidate)
      case 'number':
        if (!Number.isFinite(candidate)) throw new Error('Vault mutation command must contain finite numbers')
        return JSON.stringify(candidate)
      case 'undefined':
      case 'function':
      case 'symbol':
        return undefined
      case 'bigint':
        throw new Error('Vault mutation command must be JSON serializable')
      case 'object':
        break
    }
    if (seen.has(candidate)) throw new Error('Vault mutation command must not contain cycles')
    seen.add(candidate)
    try {
      if (Array.isArray(candidate)) {
        return `[${candidate.map(item => visit(item) ?? 'null').join(',')}]`
      }
      const record = candidate as Record<string, unknown>
      const entries = Object.keys(record).sort().flatMap((key) => {
        const encoded = visit(record[key])
        return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`]
      })
      return `{${entries.join(',')}}`
    } finally {
      seen.delete(candidate)
    }
  }
  const encoded = visit(value)
  if (encoded === undefined) throw new Error('Vault mutation command must be JSON serializable')
  return encoded
}
