import { legacySecretFieldId } from './vaultRedaction'

export function trackSecretUsageInVault(vault: unknown, secretId: unknown, usedAt = new Date().toISOString()): unknown {
  const safeSecretId = validateId(secretId, 'secret id')
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }

  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Vault payload root must be an object')
  }

  let updated = false
  const nextRoot = mapFolder(root as FolderLike, (secret) => {
    if (secret.id !== safeSecretId) return secret
    updated = true
    const usageCount = typeof secret.usageCount === 'number' && Number.isFinite(secret.usageCount)
      ? Math.max(0, Math.floor(secret.usageCount)) + 1
      : 1
    return {
      ...secret,
      usageCount,
      lastUsedAt: usedAt,
      updatedAt: usedAt,
    }
  })

  if (!updated) throw new Error('Secret not found')
  return { ...(vault as Record<string, unknown>), root: nextRoot }
}

export interface SecretUsageDelta {
  secretId: string
  count: number
  lastUsedAt: string
}

export interface SecretUsageBatchResult {
  vault: unknown
  appliedCount: number
  missingSecretIds: string[]
}

/**
 * Applies an aggregated usage batch in one tree traversal. A missing secret is
 * intentionally reported instead of failing the whole batch: a legitimate
 * delete can race an eventually durable usage flush.
 */
export function trackSecretUsageBatchInVault(
  vault: unknown,
  rawDeltas: readonly SecretUsageDelta[],
): SecretUsageBatchResult {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }
  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Vault payload root must be an object')
  }

  const deltas = new Map<string, { count: number; lastUsedAt: string }>()
  for (const rawDelta of rawDeltas) {
    const secretId = validateId(rawDelta?.secretId, 'secret id')
    const count = validateUsageCount(rawDelta?.count)
    const lastUsedAt = validateUsageTimestamp(rawDelta?.lastUsedAt)
    const current = deltas.get(secretId)
    deltas.set(secretId, {
      count: Math.min(Number.MAX_SAFE_INTEGER, (current?.count ?? 0) + count),
      lastUsedAt: laterTimestamp(current?.lastUsedAt, lastUsedAt),
    })
  }

  if (deltas.size === 0) {
    return { vault, appliedCount: 0, missingSecretIds: [] }
  }

  const found = new Set<string>()
  let appliedCount = 0
  const nextRoot = mapFolder(root as FolderLike, (secret) => {
    if (typeof secret.id !== 'string') return secret
    const delta = deltas.get(secret.id)
    if (!delta) return secret
    found.add(secret.id)
    appliedCount += delta.count
    const currentCount = typeof secret.usageCount === 'number' && Number.isFinite(secret.usageCount)
      ? Math.max(0, Math.floor(secret.usageCount))
      : 0
    return {
      ...secret,
      usageCount: Math.min(Number.MAX_SAFE_INTEGER, currentCount + delta.count),
      lastUsedAt: laterTimestamp(
        typeof secret.lastUsedAt === 'string' ? secret.lastUsedAt : undefined,
        delta.lastUsedAt,
      ),
      updatedAt: laterTimestamp(
        typeof secret.updatedAt === 'string' ? secret.updatedAt : undefined,
        delta.lastUsedAt,
      ),
    }
  })

  return {
    vault: { ...(vault as Record<string, unknown>), root: nextRoot },
    appliedCount,
    missingSecretIds: [...deltas.keys()].filter(secretId => !found.has(secretId)),
  }
}

/** Resolve one value without copying or retaining it outside the caller. */
export function resolveSecretFieldInVault(
  vault: unknown,
  secretId: unknown,
  fieldKey: unknown,
  fieldId?: unknown,
): string {
  const safeSecretId = validateId(secretId, 'secret id')
  const safeFieldKey = validateId(fieldKey, 'field key')
  const safeFieldId = fieldId === undefined ? undefined : validateId(fieldId, 'field id')
  const secret = findSecretInVault(vault, safeSecretId)
  const fields = Array.isArray(secret.fields) ? secret.fields as FieldLike[] : []
  const field = selectSecretField(fields, safeFieldKey, safeFieldId, safeSecretId)
  if (!field || typeof field.value !== 'string' || !field.value) {
    throw new Error('Secret field value is unavailable')
  }
  return field.value
}

export function assertPinnedSecretInVault(vault: unknown, secretId: unknown): void {
  const safeSecretId = validateId(secretId, 'secret id')
  const secret = findSecretInVault(vault, safeSecretId)
  const tags = Array.isArray(secret.tags) ? secret.tags : []
  const pinned = tags.some(tag => typeof tag === 'string' &&
    ['pin', 'pinned', 'favorite', 'favourite', 'starred'].includes(tag.trim().toLowerCase()))
  if (!pinned) throw new Error('Quick Reveal PIN is limited to pinned secrets')
}

/** Resolve all fields without mutating usage metadata. */
export function resolveSecretFieldsInVault(
  vault: unknown,
  secretId: unknown,
): { id?: string; key: string; value: string; sensitive: boolean }[] {
  const safeSecretId = validateId(secretId, 'secret id')
  const secret = findSecretInVault(vault, safeSecretId)
  const fields = Array.isArray(secret.fields) ? secret.fields as FieldLike[] : []
  return fieldsWithStableIdentity(fields, safeSecretId)
    .filter(field => typeof field?.key === 'string' && typeof field.value === 'string')
    .map(field => ({
      id: field.id,
      key: field.key as string,
      value: field.value as string,
      sensitive: field.sensitive === true,
    }))
}

export function copySecretFieldInVault(
  vault: unknown,
  secretId: unknown,
  fieldKey: unknown,
  usedAt = new Date().toISOString(),
): { vault: unknown; value: string } {
  const safeSecretId = validateId(secretId, 'secret id')
  const safeFieldKey = validateId(fieldKey, 'field key')
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }

  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Vault payload root must be an object')
  }

  let copiedValue: string | null = null
  const nextRoot = mapFolder(root as FolderLike, (secret) => {
    if (secret.id !== safeSecretId) return secret
    const fields = Array.isArray(secret.fields) ? secret.fields as FieldLike[] : []
    const field = selectSecretField(fields, safeFieldKey, undefined, safeSecretId)
    if (!field || typeof field.value !== 'string' || !field.value) {
      throw new Error('Secret field value is unavailable')
    }
    copiedValue = field.value
    const usageCount = typeof secret.usageCount === 'number' && Number.isFinite(secret.usageCount)
      ? Math.max(0, Math.floor(secret.usageCount)) + 1
      : 1
    return {
      ...secret,
      usageCount,
      lastUsedAt: usedAt,
      updatedAt: usedAt,
    }
  })

  if (copiedValue === null) throw new Error('Secret not found')
  return {
    vault: { ...(vault as Record<string, unknown>), root: nextRoot },
    value: copiedValue,
  }
}

export function revealSecretFieldsInVault(
  vault: unknown,
  secretId: unknown,
  usedAt = new Date().toISOString(),
): { vault: unknown; fields: { id?: string; key: string; value: string; sensitive: boolean }[] } {
  const safeSecretId = validateId(secretId, 'secret id')
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }

  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Vault payload root must be an object')
  }

  let revealedFields: { id?: string; key: string; value: string; sensitive: boolean }[] | null = null
  const nextRoot = mapFolder(root as FolderLike, (secret) => {
    if (secret.id !== safeSecretId) return secret
    const fields = Array.isArray(secret.fields) ? secret.fields as FieldLike[] : []
    revealedFields = fieldsWithStableIdentity(fields, safeSecretId)
      .filter(field => typeof field?.key === 'string' && typeof field.value === 'string')
      .map(field => ({
        id: field.id,
        key: field.key as string,
        value: field.value as string,
        sensitive: field.sensitive === true,
      }))
    const usageCount = typeof secret.usageCount === 'number' && Number.isFinite(secret.usageCount)
      ? Math.max(0, Math.floor(secret.usageCount)) + 1
      : 1
    return {
      ...secret,
      usageCount,
      lastUsedAt: usedAt,
      updatedAt: usedAt,
    }
  })

  if (revealedFields === null) throw new Error('Secret not found')
  return {
    vault: { ...(vault as Record<string, unknown>), root: nextRoot },
    fields: revealedFields,
  }
}

interface FolderLike {
  children?: unknown
  secrets?: unknown
  [key: string]: unknown
}

interface SecretLike {
  id?: unknown
  usageCount?: unknown
  fields?: unknown
  [key: string]: unknown
}

interface FieldLike {
  id?: unknown
  key?: unknown
  value?: unknown
  sensitive?: unknown
}

function selectSecretField(
  fields: FieldLike[],
  fieldKey: string,
  fieldId?: string,
  secretId?: string,
): FieldLike | undefined {
  if (fieldId) {
    const field = secretId
      ? fieldsWithStableIdentity(fields, secretId).find(item => item.id === fieldId)
      : fields.find(item => item?.id === fieldId)
    if (!field) throw new Error('Secret field identity is unavailable')
    if (field.key !== fieldKey) throw new Error('Secret field label is stale')
    return field
  }
  const matches = fields.filter(item => item?.key === fieldKey)
  if (matches.length > 1) {
    throw new Error('Secret field label is ambiguous; use its stable field identity')
  }
  return matches[0]
}

function fieldsWithStableIdentity(
  fields: FieldLike[],
  secretId: string,
): Array<FieldLike & { id: string }> {
  const occurrences = new Map<string, number>()
  return fields.map((field) => {
    const key = typeof field.key === 'string' ? field.key : ''
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    return {
      ...field,
      id: typeof field.id === 'string' && field.id
        ? field.id
        : legacySecretFieldId(secretId, key, occurrence),
    }
  })
}

function mapFolder(folder: FolderLike, mapSecret: (secret: SecretLike) => SecretLike): FolderLike {
  const secrets = Array.isArray(folder.secrets)
    ? folder.secrets.map(secret =>
        secret && typeof secret === 'object' && !Array.isArray(secret)
          ? mapSecret(secret as SecretLike)
          : secret
      )
    : folder.secrets

  const children = Array.isArray(folder.children)
    ? folder.children.map(child =>
        child && typeof child === 'object' && !Array.isArray(child)
          ? mapFolder(child as FolderLike, mapSecret)
          : child
      )
    : folder.children

  return { ...folder, secrets, children }
}

function validateId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function findSecretInVault(vault: unknown, secretId: string): SecretLike {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }
  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Vault payload root must be an object')
  }

  const pending: FolderLike[] = [root as FolderLike]
  while (pending.length > 0) {
    const folder = pending.pop()!
    if (Array.isArray(folder.secrets)) {
      for (const candidate of folder.secrets) {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          const secret = candidate as SecretLike
          if (secret.id === secretId) return secret
        }
      }
    }
    if (Array.isArray(folder.children)) {
      for (const child of folder.children) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          pending.push(child as FolderLike)
        }
      }
    }
  }
  throw new Error('Secret not found')
}

function validateUsageCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Invalid usage count')
  }
  return value
}

function validateUsageTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid usage timestamp')
  }
  return value
}

function laterTimestamp(current: string | undefined, candidate: string): string {
  if (!current || Number.isNaN(Date.parse(current))) return candidate
  return Date.parse(candidate) >= Date.parse(current) ? candidate : current
}
