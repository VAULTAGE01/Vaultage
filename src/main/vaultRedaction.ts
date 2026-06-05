import {
  REDACTED_PROVIDER_CONFIG_VALUE,
  REDACTED_SECRET_VALUE,
  isRedactedProviderConfigValue,
  isRedactedSecretValue,
} from '../shared/vaultRedaction'

const SENSITIVE_PROVIDER_CONFIG_KEY_RE =
  /(?:token|secret|password|authorization|credential|apiKey|accessKey|privateKey|headerValue)/i

export function redactVaultForRenderer(vault: unknown): unknown {
  if (!isRecord(vault)) return cloneJsonValue(vault)
  return {
    ...cloneJsonObject(vault),
    root: redactFolder(vault.root),
    providers: Array.isArray(vault.providers)
      ? vault.providers.map(redactProvider)
      : cloneJsonValue(vault.providers),
    preferences: redactPreferences(vault.preferences),
  }
}

export function mergeRedactedVaultValues(incoming: unknown, current: unknown): unknown {
  if (!isRecord(incoming)) return cloneJsonValue(incoming)
  const fieldIndex = buildCurrentSecretFieldIndex(current)
  const providerIndex = buildCurrentProviderConfigIndex(current)
  return {
    ...cloneJsonObject(incoming),
    root: mergeFolder(incoming.root, fieldIndex, new Map()),
    providers: Array.isArray(incoming.providers)
      ? incoming.providers.map(provider => mergeProvider(provider, providerIndex))
      : cloneJsonValue(incoming.providers),
    preferences: mergePreferences(incoming.preferences, isRecord(current) ? current.preferences : undefined),
  }
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
  return {
    ...cloneJsonObject(secret),
    fields: Array.isArray(secret.fields) ? secret.fields.map(redactField) : cloneJsonValue(secret.fields),
  }
}

function redactField(field: unknown): unknown {
  if (!isRecord(field)) return cloneJsonValue(field)
  const next = cloneJsonObject(field)
  if (
    field.sensitive === true &&
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
      SENSITIVE_PROVIDER_CONFIG_KEY_RE.test(key) &&
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

function mergePreferences(incoming: unknown, current: unknown): unknown {
  if (!isRecord(incoming)) return cloneJsonValue(incoming)
  const next = cloneJsonObject(incoming)
  if (isRecord(current) && isRecord(current.quickRevealPin) && !isRecord(incoming.quickRevealPin)) {
    next.quickRevealPin = cloneJsonObject(current.quickRevealPin)
    next.quickRevealPinEnabled = true
  }
  return next
}

function mergeFolder(folder: unknown, index: SecretFieldIndex, counters: Map<string, number>): unknown {
  if (!isRecord(folder)) return cloneJsonValue(folder)
  return {
    ...cloneJsonObject(folder),
    secrets: Array.isArray(folder.secrets)
      ? folder.secrets.map(secret => mergeSecret(secret, index, counters))
      : cloneJsonValue(folder.secrets),
    children: Array.isArray(folder.children)
      ? folder.children.map(child => mergeFolder(child, index, counters))
      : cloneJsonValue(folder.children),
  }
}

function mergeSecret(secret: unknown, index: SecretFieldIndex, counters: Map<string, number>): unknown {
  if (!isRecord(secret)) return cloneJsonValue(secret)
  const secretId = typeof secret.id === 'string' ? secret.id : null
  return {
    ...cloneJsonObject(secret),
    fields: Array.isArray(secret.fields)
      ? secret.fields.map((field, fieldPosition) => mergeField(field, secretId, fieldPosition, index, counters))
      : cloneJsonValue(secret.fields),
  }
}

function mergeField(
  field: unknown,
  secretId: string | null,
  fieldPosition: number,
  index: SecretFieldIndex,
  counters: Map<string, number>,
): unknown {
  if (!isRecord(field)) return cloneJsonValue(field)
  const next = cloneJsonObject(field)
  const fieldIndexKey = secretId && typeof field.key === 'string' ? `${secretId}\u0000${field.key}` : null
  const occurrence = fieldIndexKey ? (counters.get(fieldIndexKey) ?? 0) : 0
  if (fieldIndexKey) counters.set(fieldIndexKey, occurrence + 1)
  if (!isRedactedSecretValue(field.value)) return next
  if (field.sensitive !== true) {
    throw new Error('Redacted secret field cannot be saved as non-sensitive')
  }
  if (!secretId || typeof field.key !== 'string') {
    throw new Error('Redacted secret field cannot be saved without a matching secret')
  }

  const currentSecret = index.get(secretId)
  const currentValues = currentSecret?.byKey.get(field.key)
  const currentValue = currentValues?.[occurrence]
  const fallbackCurrentValue = currentSecret?.ordered[fieldPosition]
  if (typeof currentValue === 'string') {
    next.value = currentValue
  } else if (typeof fallbackCurrentValue === 'string') {
    next.value = fallbackCurrentValue
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
  byKey: Map<string, string[]>
  ordered: string[]
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
  if (!isRecord(secret) || typeof secret.id !== 'string' || !Array.isArray(secret.fields)) return
  let secretFields = index.get(secret.id)
  if (!secretFields) {
    secretFields = { byKey: new Map(), ordered: [] }
    index.set(secret.id, secretFields)
  }

  for (const field of secret.fields) {
    if (!isRecord(field) || typeof field.key !== 'string' || typeof field.value !== 'string') continue
    secretFields.ordered.push(field.value)
    const values = secretFields.byKey.get(field.key) ?? []
    values.push(field.value)
    secretFields.byKey.set(field.key, values)
  }
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
