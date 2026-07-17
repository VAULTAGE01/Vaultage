/**
 * Main and renderer share one conservative provider-config confidentiality
 * policy. A field in this set is never returned to React once persisted, even
 * when it is an identifier rather than a bearer credential, because the setup
 * UI explicitly treats it as sensitive.
 */
export const SENSITIVE_PROVIDER_CONFIG_KEYS = new Set([
  'token',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
  'adminKey',
  'accountSid',
  'authToken',
  'apiKeySid',
  'apiKeySecret',
  'headerValue',
])

const CONSERVATIVE_SENSITIVE_KEY_RE =
  /(?:token|secret|password|credential|authorization|private.?key|api.?key|access.?key|admin.?key|header.?value)/i

export function isSensitiveProviderConfigKey(key: unknown): boolean {
  return typeof key === 'string'
    && (SENSITIVE_PROVIDER_CONFIG_KEYS.has(key) || CONSERVATIVE_SENSITIVE_KEY_RE.test(key))
}
