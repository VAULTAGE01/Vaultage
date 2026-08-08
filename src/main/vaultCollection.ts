import { VAULT_VALIDATION_LIMITS } from '../shared/vaultValidation'
import {
  validateVaultRecordManifest,
  type VaultRecordManifest,
} from './vaultRecordStore'

export const VAULT_COLLECTION_FORMAT = 'vaultage.vault-collection.v1'
export const MAX_VAULT_COLLECTION_ENTRIES = VAULT_VALIDATION_LIMITS.maxFolders
export const MAX_RECENT_VAULT_COLLECTION_MUTATION_RECEIPTS = 16

export const VAULT_COLLECTION_MUTATION_TYPES = [
  'create',
  'switch',
  'rename',
  'archive',
  'delete',
] as const

export type VaultCollectionMutationType = typeof VAULT_COLLECTION_MUTATION_TYPES[number]

export interface VaultCollectionEntry {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  archived: boolean
  manifest: VaultRecordManifest
}

export interface VaultCollectionManifest {
  format: typeof VAULT_COLLECTION_FORMAT
  storageVersion: 1
  revision: number
  activeVaultId: string
  vaults: VaultCollectionEntry[]
  recentMutationReceipts?: VaultCollectionMutationReceipt[]
}

export interface VaultCollectionSummary {
  revision: number
  activeVaultId: string
  vaults: Array<Omit<VaultCollectionEntry, 'manifest'>>
}

/**
 * Bounded plaintext-value-free receipt for a collection-management commit.
 * The result snapshot makes a lost IPC response retry deterministic without
 * reapplying the operation against a later collection revision.
 */
export interface VaultCollectionMutationReceipt {
  operationId: string
  expectedRevision: number
  revision: number
  type: VaultCollectionMutationType
  fingerprint: string
  targetVaultId: string
  result: VaultCollectionSummary
}

export interface VaultCollectionMutationReceiptInput {
  operationId: string
  expectedRevision: number
  type: VaultCollectionMutationType
  fingerprint: string
  targetVaultId: string
}

export function isVaultCollectionManifest(value: unknown): value is VaultCollectionManifest {
  return Boolean(
    isRecord(value)
    && value.format === VAULT_COLLECTION_FORMAT,
  )
}

export function validateVaultCollectionManifest(value: unknown): VaultCollectionManifest {
  const collection = exactRecord(
    value,
    ['format', 'storageVersion', 'revision', 'activeVaultId', 'vaults'],
    'vault collection',
    ['recentMutationReceipts'],
  )
  if (collection.format !== VAULT_COLLECTION_FORMAT || collection.storageVersion !== 1) {
    throw new Error('Unsupported vault collection manifest')
  }
  const revision = positiveInteger(collection.revision, 'vault collection revision')
  const activeVaultId = vaultId(collection.activeVaultId)
  if (!Array.isArray(collection.vaults) || collection.vaults.length < 1) {
    throw new Error('Vault collection must contain at least one vault')
  }
  if (collection.vaults.length > MAX_VAULT_COLLECTION_ENTRIES) {
    throw new Error('Vault collection contains too many entries')
  }

  const seen = new Set<string>()
  const vaults = collection.vaults.map((value, index): VaultCollectionEntry => {
    const entry = exactRecord(
      value,
      ['id', 'name', 'createdAt', 'updatedAt', 'archived', 'manifest'],
      `vault collection entry ${index}`,
    )
    const id = vaultId(entry.id)
    if (seen.has(id)) throw new Error('Vault collection contains a duplicate vault id')
    seen.add(id)
    const createdAt = isoDateTime(entry.createdAt, 'vault collection creation time')
    const updatedAt = isoDateTime(entry.updatedAt, 'vault collection update time')
    if (updatedAt < createdAt) throw new Error('Vault collection update time precedes creation')
    if (typeof entry.archived !== 'boolean') throw new Error('Vault collection archive state must be a boolean')
    return {
      id,
      name: vaultName(entry.name),
      createdAt,
      updatedAt,
      archived: entry.archived,
      manifest: validateVaultRecordManifest(entry.manifest),
    }
  })

  const active = vaults.find(entry => entry.id === activeVaultId)
  if (!active) throw new Error('Vault collection active vault does not exist')
  if (active.archived) throw new Error('Vault collection active vault cannot be archived')
  const recentMutationReceipts = readMutationReceipts(collection.recentMutationReceipts)
  return {
    format: VAULT_COLLECTION_FORMAT,
    storageVersion: 1,
    revision,
    activeVaultId,
    vaults,
    ...(recentMutationReceipts.length > 0 ? { recentMutationReceipts } : {}),
  }
}

export function createVaultCollectionManifest(input: {
  id: string
  manifest: VaultRecordManifest
  now: string
}): VaultCollectionManifest {
  const id = vaultId(input.id)
  const now = isoDateTime(input.now, 'vault collection creation time')
  return validateVaultCollectionManifest({
    format: VAULT_COLLECTION_FORMAT,
    storageVersion: 1,
    revision: 1,
    activeVaultId: id,
    vaults: [{
      id,
      name: 'Default',
      createdAt: now,
      updatedAt: now,
      archived: false,
      manifest: input.manifest,
    }],
  })
}

export function summarizeVaultCollection(collection: VaultCollectionManifest): VaultCollectionSummary {
  return summarizeValidatedVaultCollection(validateVaultCollectionManifest(collection))
}

export function findVaultCollectionMutationReceipt(
  collection: VaultCollectionManifest,
  input: Pick<VaultCollectionMutationReceiptInput, 'operationId' | 'fingerprint'>,
): VaultCollectionMutationReceipt | null {
  const operationId = vaultId(input.operationId)
  const fingerprint = sha256(input.fingerprint, 'vault collection mutation fingerprint')
  const receipt = (collection.recentMutationReceipts ?? []).findLast(candidate => candidate.operationId === operationId) ?? null
  if (receipt && receipt.fingerprint !== fingerprint) {
    throw new Error('Vault collection operation id was already used for a different operation')
  }
  return receipt
}

export function withVaultCollectionMutationReceipt(
  collection: VaultCollectionManifest,
  input: VaultCollectionMutationReceiptInput,
): { collection: VaultCollectionManifest; receipt: VaultCollectionMutationReceipt } {
  const validated = validateVaultCollectionManifest(collection)
  const receipt: VaultCollectionMutationReceipt = {
    operationId: vaultId(input.operationId),
    expectedRevision: positiveInteger(input.expectedRevision, 'vault collection expected revision'),
    revision: validated.revision,
    type: mutationType(input.type),
    fingerprint: sha256(input.fingerprint, 'vault collection mutation fingerprint'),
    targetVaultId: vaultId(input.targetVaultId),
    result: summarizeValidatedVaultCollection(validated),
  }
  const next = validateVaultCollectionManifest({
    ...validated,
    recentMutationReceipts: [
      ...(validated.recentMutationReceipts ?? []).filter(candidate => candidate.operationId !== receipt.operationId),
      receipt,
    ].slice(-MAX_RECENT_VAULT_COLLECTION_MUTATION_RECEIPTS),
  })
  return { collection: next, receipt }
}

function summarizeValidatedVaultCollection(validated: VaultCollectionManifest): VaultCollectionSummary {
  return {
    revision: validated.revision,
    activeVaultId: validated.activeVaultId,
    vaults: validated.vaults.map(({ manifest: _manifest, ...entry }) => entry),
  }
}

export function requireVaultCollectionEntry(
  collection: VaultCollectionManifest,
  idValue: unknown,
): VaultCollectionEntry {
  const id = vaultId(idValue)
  const entry = collection.vaults.find(candidate => candidate.id === id)
  if (!entry) throw new Error('Vault does not exist')
  return entry
}

export function validateNewVaultName(value: unknown): string {
  return vaultName(value)
}

export function validateExactVaultId(value: unknown): string {
  return vaultId(value)
}

function vaultId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > VAULT_VALIDATION_LIMITS.maxIdChars
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('Invalid vault id')
  }
  return value
}

function vaultName(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > VAULT_VALIDATION_LIMITS.maxNameChars
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('Invalid vault name')
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function isoDateTime(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO 8601 date-time`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be an ISO 8601 date-time`)
  }
  return value
}

function readMutationReceipts(value: unknown): VaultCollectionMutationReceipt[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_RECENT_VAULT_COLLECTION_MUTATION_RECEIPTS) {
    throw new Error('Vault collection mutation receipts are invalid')
  }
  const seen = new Set<string>()
  return value.map((candidate, index) => {
    const receipt = exactRecord(
      candidate,
      ['operationId', 'expectedRevision', 'revision', 'type', 'fingerprint', 'targetVaultId', 'result'],
      `vault collection mutation receipt ${index}`,
    )
    const operationId = vaultId(receipt.operationId)
    if (seen.has(operationId)) throw new Error('Vault collection contains a duplicate mutation receipt')
    seen.add(operationId)
    const parsed: VaultCollectionMutationReceipt = {
      operationId,
      expectedRevision: positiveInteger(receipt.expectedRevision, 'vault collection expected revision'),
      revision: positiveInteger(receipt.revision, 'vault collection mutation receipt revision'),
      type: mutationType(receipt.type),
      fingerprint: sha256(receipt.fingerprint, 'vault collection mutation fingerprint'),
      targetVaultId: vaultId(receipt.targetVaultId),
      result: validateVaultCollectionSummary(receipt.result),
    }
    if (parsed.result.revision !== parsed.revision) {
      throw new Error('Vault collection mutation receipt result revision does not match')
    }
    return parsed
  })
}

function validateVaultCollectionSummary(value: unknown): VaultCollectionSummary {
  const summary = exactRecord(value, ['revision', 'activeVaultId', 'vaults'], 'vault collection mutation result')
  const revision = positiveInteger(summary.revision, 'vault collection mutation result revision')
  const activeVaultId = vaultId(summary.activeVaultId)
  if (!Array.isArray(summary.vaults) || summary.vaults.length < 1 || summary.vaults.length > MAX_VAULT_COLLECTION_ENTRIES) {
    throw new Error('Vault collection mutation result vaults are invalid')
  }
  const seen = new Set<string>()
  const vaults = summary.vaults.map((value, index) => {
    const entry = exactRecord(value, ['id', 'name', 'createdAt', 'updatedAt', 'archived'], `vault collection mutation result vault ${index}`)
    const id = vaultId(entry.id)
    if (seen.has(id)) throw new Error('Vault collection mutation result contains a duplicate vault id')
    seen.add(id)
    return {
      id,
      name: vaultName(entry.name),
      createdAt: isoDateTime(entry.createdAt, 'vault collection mutation result creation time'),
      updatedAt: isoDateTime(entry.updatedAt, 'vault collection mutation result update time'),
      archived: booleanValue(entry.archived, 'vault collection mutation result archive state'),
    }
  })
  const active = vaults.find(vault => vault.id === activeVaultId)
  if (!active || active.archived) throw new Error('Vault collection mutation result active vault is invalid')
  return { revision, activeVaultId, vaults }
}

function mutationType(value: unknown): VaultCollectionMutationType {
  if (typeof value !== 'string' || !(VAULT_COLLECTION_MUTATION_TYPES as readonly string[]).includes(value)) {
    throw new Error('Invalid vault collection mutation type')
  }
  return value as VaultCollectionMutationType
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const allowed = new Set([...keys, ...optionalKeys])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains an unsupported property`)
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} is missing a required property`)
    }
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
