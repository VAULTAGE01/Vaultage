import {
  ENV_KEY_RE,
  MAX_ENV_ENTRIES,
  MAX_ENV_VALUE_BYTES,
} from './security'

export interface EnvSelection {
  envKey: string
  secretId: string
  fieldKey: string
}

export interface ResolvedEnvSelection extends EnvSelection {
  value: string
  scope?: string
}

interface VaultLike {
  root?: FolderLike
}

interface FolderLike {
  children?: unknown
  secrets?: unknown
}

interface SecretLike {
  id?: unknown
  scope?: unknown
  fields?: unknown
}

interface FieldLike {
  key?: unknown
  value?: unknown
}

export function resolveVaultEnvSelections(
  vault: unknown,
  selections: unknown,
): ResolvedEnvSelection[] {
  const safeSelections = validateEnvSelections(selections)
  const root = vault && typeof vault === 'object' && !Array.isArray(vault)
    ? (vault as VaultLike).root
    : undefined
  if (!root) throw new Error('Open vault is unavailable')

  return safeSelections.map((selection) => {
    const secret = findSecret(root, selection.secretId)
    if (!secret) throw new Error(`Secret not found for ${selection.envKey}`)

    const fields = Array.isArray(secret.fields) ? secret.fields as FieldLike[] : []
    const field = fields.find(item => item?.key === selection.fieldKey)
    if (!field) throw new Error(`Field not found for ${selection.envKey}`)
    if (typeof field.value !== 'string' || field.value.length === 0) {
      throw new Error(`Field value is unavailable for ${selection.envKey}`)
    }
    if (Buffer.byteLength(field.value, 'utf8') > MAX_ENV_VALUE_BYTES) {
      throw new Error(`Value too large for ${selection.envKey}`)
    }

    return {
      ...selection,
      value: field.value,
      scope: typeof secret.scope === 'string' ? secret.scope : undefined,
    }
  })
}

function validateEnvSelections(input: unknown): EnvSelection[] {
  if (!Array.isArray(input)) throw new Error('selections must be an array')
  if (input.length === 0) throw new Error('At least one secret selection is required')
  if (input.length > MAX_ENV_ENTRIES) throw new Error('too many secret selections')

  const seenEnvKeys = new Set<string>()
  return input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Invalid secret selection')
    }
    const selection = item as Record<string, unknown>
    const envKey = requireIdentifier(selection.envKey, 'env key', ENV_KEY_RE)
    if (seenEnvKeys.has(envKey)) throw new Error(`Duplicate env key: ${envKey}`)
    seenEnvKeys.add(envKey)

    return {
      envKey,
      secretId: requireIdentifier(selection.secretId, 'secret id'),
      fieldKey: requireIdentifier(selection.fieldKey, 'field key'),
    }
  })
}

function requireIdentifier(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  if (pattern && !pattern.test(value)) throw new Error(`Invalid ${label}: ${value}`)
  return value
}

function findSecret(folder: FolderLike, secretId: string): SecretLike | null {
  const secrets = Array.isArray(folder.secrets) ? folder.secrets as SecretLike[] : []
  for (const secret of secrets) {
    if (secret?.id === secretId) return secret
  }

  const children = Array.isArray(folder.children) ? folder.children as FolderLike[] : []
  for (const child of children) {
    const found = findSecret(child, secretId)
    if (found) return found
  }
  return null
}
