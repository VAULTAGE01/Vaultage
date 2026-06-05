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
    const field = fields.find(item => item?.key === safeFieldKey)
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
): { vault: unknown; fields: { key: string; value: string; sensitive: boolean }[] } {
  const safeSecretId = validateId(secretId, 'secret id')
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }

  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Vault payload root must be an object')
  }

  let revealedFields: { key: string; value: string; sensitive: boolean }[] | null = null
  const nextRoot = mapFolder(root as FolderLike, (secret) => {
    if (secret.id !== safeSecretId) return secret
    const fields = Array.isArray(secret.fields) ? secret.fields as FieldLike[] : []
    revealedFields = fields
      .filter(field => typeof field?.key === 'string' && typeof field.value === 'string')
      .map(field => ({
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
  key?: unknown
  value?: unknown
  sensitive?: unknown
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
