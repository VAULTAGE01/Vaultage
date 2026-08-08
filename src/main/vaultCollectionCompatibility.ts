import { VAULT_VALIDATION_LIMITS } from '../shared/vaultValidation'
import {
  validateVaultRecordManifest,
  type VaultRecordManifest,
} from './vaultRecordStore'

const PREVIEW_VAULT_COLLECTION_FORMAT = 'vaultage.vault-collection.v1'

export interface AuthenticatedSingleVaultCollection {
  activeVaultId: string
  manifest: VaultRecordManifest
}

export class UnsupportedMultiVaultCollectionError extends Error {
  readonly name = 'UnsupportedMultiVaultCollectionError'
  readonly code = 'multi_vault_unsupported'

  constructor() {
    super('Vault collection contains multiple vaults and requires multi-vault support')
  }
}

/**
 * Reads the exact one-vault envelope written by the unmerged multi-vault
 * preview. A collection with more than one vault stays fail-closed because
 * downgrading it to the current single-vault manifest would discard data.
 */
export function parseAuthenticatedSingleVaultCollection(
  value: unknown,
): AuthenticatedSingleVaultCollection | null {
  const collection = record(value)
  if (collection?.format !== PREVIEW_VAULT_COLLECTION_FORMAT) return null
  requireExactKeys(
    collection,
    ['format', 'storageVersion', 'revision', 'activeVaultId', 'vaults'],
    'vault collection',
  )
  if (collection.storageVersion !== 1) throw new Error('Unsupported vault collection manifest')
  requirePositiveInteger(collection.revision, 'vault collection revision')
  const activeVaultId = requireId(collection.activeVaultId, 'active vault id')
  if (!Array.isArray(collection.vaults) || collection.vaults.length < 1) {
    throw new Error('Vault collection must contain at least one vault')
  }
  if (collection.vaults.length !== 1) {
    throw new UnsupportedMultiVaultCollectionError()
  }

  const entry = record(collection.vaults[0])
  if (!entry) throw new Error('Vault collection entry must be an object')
  requireExactKeys(
    entry,
    ['id', 'name', 'createdAt', 'updatedAt', 'archived', 'manifest'],
    'vault collection entry',
  )
  const id = requireId(entry.id, 'vault id')
  requireName(entry.name)
  const createdAt = requireIsoDateTime(entry.createdAt, 'vault collection creation time')
  const updatedAt = requireIsoDateTime(entry.updatedAt, 'vault collection update time')
  if (updatedAt < createdAt) throw new Error('Vault collection update time precedes creation')
  if (entry.archived !== false || id !== activeVaultId) {
    throw new Error('Vault collection active vault is unavailable')
  }
  return {
    activeVaultId,
    manifest: validateVaultRecordManifest(entry.manifest),
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains an unsupported property`)
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} is missing a required property`)
    }
  }
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function requireId(value: unknown, label: string): string {
  return requireText(value, VAULT_VALIDATION_LIMITS.maxIdChars, label)
}

function requireName(value: unknown): string {
  return requireText(value, VAULT_VALIDATION_LIMITS.maxNameChars, 'vault name')
}

function requireText(value: unknown, maxLength: number, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maxLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireIsoDateTime(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO 8601 date-time`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be an ISO 8601 date-time`)
  }
  return value
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
