import { createHash } from 'crypto'
import {
  REDACTED_PROVIDER_CONFIG_VALUE,
  REDACTED_SECRET_VALUE,
  isRedactedProviderConfigValue,
  isRedactedSecretValue,
} from '../shared/vaultRedaction'
import { isSensitiveProviderConfigKey } from '../shared/providerConfigPolicy'

export function redactVaultForRenderer(vault: unknown): unknown {
  if (!isRecord(vault)) return cloneJsonValue(vault)
  const redacted: Record<string, unknown> = {
    ...cloneJsonObject(vault),
    root: redactFolder(vault.root),
    providers: Array.isArray(vault.providers)
      ? vault.providers.map(redactProvider)
      : cloneJsonValue(vault.providers),
    preferences: redactPreferences(vault.preferences),
  }
  delete redacted._vaultage
  return redacted
}

/** Restore only the main-owned values of one renderer-redacted secret. */
export function mergeRedactedSecretValues(incoming: unknown, current: unknown): unknown {
  const index = buildCurrentSecretFieldIndex({
    root: { children: [], secrets: [current] },
  })
  return mergeSecret(incoming, index)
}

/** Restore only the main-owned values of one renderer-redacted provider. */
export function mergeRedactedProviderValues(incoming: unknown, current: unknown): unknown {
  const index = buildCurrentProviderConfigIndex({ providers: [current] })
  return mergeProvider(incoming, index)
}

function redactFolder(folder: unknown): unknown {
  if (!isRecord(folder)) return cloneJsonValue(folder)
  return {
    ...cloneJsonObject(folder),
    secrets: Array.isArray(folder.secrets) ? folder.secrets.map(redactSecret) : cloneJsonValue(folder.secrets),
    children: Array.isArray(folder.children) ? folder.children.map(redactFolder) : cloneJsonValue(folder.children),
  }
}

function redactSecret(secret: unknown): unknown {
  if (!isRecord(secret)) return cloneJsonValue(secret)
  const secureNote = secret.type === 'secureNote'
  const secretId = typeof secret.id === 'string' ? secret.id : 'unknown-secret'
  const occurrences = new Map<string, number>()
  const next = cloneJsonObject(secret)
  if (secureNote && typeof secret.notes === 'string' && secret.notes.length > 0) {
    next.notes = REDACTED_SECRET_VALUE
  }
  next.fields = Array.isArray(secret.fields)
    ? secret.fields.map(field => {
        const key = isRecord(field) && typeof field.key === 'string' ? field.key : ''
        const occurrence = occurrences.get(key) ?? 0
        occurrences.set(key, occurrence + 1)
        const fieldId = isRecord(field) && validFieldId(field.id)
          ? field.id
          : legacySecretFieldId(secretId, key, occurrence)
        return redactField(field, fieldId, secureNote)
      })
    : cloneJsonValue(secret.fields)
  return next
}

function redactField(field: unknown, fieldId: string, forceSensitive = false): unknown {
  if (!isRecord(field)) return cloneJsonValue(field)
  const next: Record<string, unknown> = { ...cloneJsonObject(field), id: fieldId }
  if (forceSensitive) next.sensitive = true
  if (
    (forceSensitive || field.sensitive === true) &&
    typeof field.value === 'string' &&
    field.value.length > 0
  ) {
    next.value = REDACTED_SECRET_VALUE
  }
  return next
}

function redactProvider(provider: unknown): unknown {
  if (!isRecord(provider)) return cloneJsonValue(provider)
  return {
    ...cloneJsonObject(provider),
    config: redactProviderConfig(provider.config),
  }
}

function redactProviderConfig(config: unknown): unknown {
  if (!isRecord(config)) return cloneJsonValue(config)
  const next = cloneJsonObject(config)
  for (const [key, value] of Object.entries(config)) {
    if (
      isSensitiveProviderConfigKey(key) &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      next[key] = REDACTED_PROVIDER_CONFIG_VALUE
    }
  }
  return next
}

function redactPreferences(preferences: unknown): unknown {
  if (!isRecord(preferences)) return cloneJsonValue(preferences)
  const next = cloneJsonObject(preferences)
  const hasQuickRevealPin = isRecord(preferences.quickRevealPin)
  delete next.quickRevealPin
  next.quickRevealPinEnabled = hasQuickRevealPin || preferences.quickRevealPinEnabled === true
  return next
}

function mergeSecret(secret: unknown, index: SecretFieldIndex): unknown {
  if (!isRecord(secret)) return cloneJsonValue(secret)
  const secretId = typeof secret.id === 'string' ? secret.id : null
  const secureNote = secret.type === 'secureNote'
  const next = cloneJsonObject(secret)
  // A form may change the type of a secure note while its legacy notes remain
  // redacted. Restore by sentinel identity regardless of the incoming type so
  // the transition cannot erase or persist the placeholder.
  if (isRedactedSecretValue(secret.notes)) {
    const currentNotes = secretId ? index.get(secretId)?.notes : undefined
    if (typeof currentNotes !== 'string') {
      throw new Error('Redacted secure-note metadata cannot be saved without a current value')
    }
    next.notes = currentNotes
  }
  next.fields = Array.isArray(secret.fields)
    ? secret.fields.map(field => mergeField(field, secretId, index, secureNote))
    : cloneJsonValue(secret.fields)
  return next
}

function mergeField(
  field: unknown,
  secretId: string | null,
  index: SecretFieldIndex,
  forceSensitive = false,
): unknown {
  if (!isRecord(field)) return cloneJsonValue(field)
  const next = cloneJsonObject(field)
  if (forceSensitive) next.sensitive = true
  if (!isRedactedSecretValue(field.value)) return next
  if (next.sensitive !== true) {
    throw new Error('Redacted secret field cannot be saved as non-sensitive')
  }
  if (!secretId || !validFieldId(field.id)) {
    throw new Error('Redacted secret field cannot be saved without a matching secret')
  }

  const currentSecret = index.get(secretId)
  const currentValue = currentSecret?.byId.get(field.id)
  if (typeof currentValue === 'string') {
    next.value = currentValue
  } else {
    throw new Error('Redacted secret field cannot be saved without a current value')
  }
  return next
}

function mergeProvider(provider: unknown, index: ProviderConfigIndex): unknown {
  if (!isRecord(provider)) return cloneJsonValue(provider)
  return {
    ...cloneJsonObject(provider),
    config: mergeProviderConfig(provider.id, provider.config, index),
  }
}

function mergeProviderConfig(
  providerId: unknown,
  config: unknown,
  index: ProviderConfigIndex,
): unknown {
  if (!isRecord(config)) return cloneJsonValue(config)
  const next = cloneJsonObject(config)
  if (typeof providerId !== 'string') return next
  const current = index.get(providerId)
  for (const [key, value] of Object.entries(config)) {
    if (!isRedactedProviderConfigValue(value)) continue
    const currentValue = current?.get(key)
    if (typeof currentValue !== 'string') {
      throw new Error('Redacted provider config cannot be saved without a current value')
    }
    next[key] = currentValue
  }
  return next
}

interface CurrentSecretFields {
  byId: Map<string, string>
  notes?: string
}

type SecretFieldIndex = Map<string, CurrentSecretFields>

type ProviderConfigIndex = Map<string, Map<string, string>>

function buildCurrentSecretFieldIndex(vault: unknown): SecretFieldIndex {
  const index: SecretFieldIndex = new Map()
  if (!isRecord(vault)) return index
  walkCurrentFolder(vault.root, index)
  return index
}

function walkCurrentFolder(folder: unknown, index: SecretFieldIndex): void {
  if (!isRecord(folder)) return
  if (Array.isArray(folder.secrets)) {
    for (const secret of folder.secrets) addCurrentSecretFields(secret, index)
  }
  if (Array.isArray(folder.children)) {
    for (const child of folder.children) walkCurrentFolder(child, index)
  }
}

function addCurrentSecretFields(secret: unknown, index: SecretFieldIndex): void {
  if (!isRecord(secret) || typeof secret.id !== 'string') return
  let secretFields = index.get(secret.id)
  if (!secretFields) {
    secretFields = {
      byId: new Map(),
      notes: typeof secret.notes === 'string' ? secret.notes : undefined,
    }
    index.set(secret.id, secretFields)
  }

  if (!Array.isArray(secret.fields)) return
  const occurrences = new Map<string, number>()
  for (const field of secret.fields) {
    if (!isRecord(field) || typeof field.key !== 'string' || typeof field.value !== 'string') continue
    const occurrence = occurrences.get(field.key) ?? 0
    occurrences.set(field.key, occurrence + 1)
    const fieldId = validFieldId(field.id)
      ? field.id
      : legacySecretFieldId(secret.id, field.key, occurrence)
    if (secretFields.byId.has(fieldId)) throw new Error('Duplicate secret field id')
    secretFields.byId.set(fieldId, field.value)
  }
}

export function legacySecretFieldId(secretId: string, fieldKey: string, occurrence: number): string {
  const digest = createHash('sha256')
    .update('vaultage-field-v1\0', 'utf8')
    .update(secretId, 'utf8')
    .update('\0', 'utf8')
    .update(fieldKey, 'utf8')
    .update('\0', 'utf8')
    .update(String(occurrence), 'utf8')
    .digest('hex')
  return `field-legacy-${digest}`
}

function validFieldId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function buildCurrentProviderConfigIndex(vault: unknown): ProviderConfigIndex {
  const index: ProviderConfigIndex = new Map()
  if (!isRecord(vault) || !Array.isArray(vault.providers)) return index

  for (const provider of vault.providers) {
    if (!isRecord(provider) || typeof provider.id !== 'string' || !isRecord(provider.config)) continue
    const config = new Map<string, string>()
    for (const [key, value] of Object.entries(provider.config)) {
      if (typeof value === 'string') config.set(key, value)
    }
    index.set(provider.id, config)
  }

  return index
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) next[key] = cloneJsonValue(item)
  return next
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (isRecord(value)) return cloneJsonObject(value)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
