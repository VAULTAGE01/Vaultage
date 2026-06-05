export const REDACTED_SECRET_VALUE = '__VAULTAGE_REDACTED_SECRET_FIELD__'
export const REDACTED_PROVIDER_CONFIG_VALUE = '__VAULTAGE_REDACTED_PROVIDER_CONFIG__'

export function isRedactedSecretValue(value: unknown): value is typeof REDACTED_SECRET_VALUE {
  return value === REDACTED_SECRET_VALUE
}

export function isRedactedProviderConfigValue(value: unknown): value is typeof REDACTED_PROVIDER_CONFIG_VALUE {
  return value === REDACTED_PROVIDER_CONFIG_VALUE
}
