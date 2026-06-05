import { isAbsolute, normalize } from 'path'
import { isIP } from 'net'
import { formatDotenvEntries, formatDotenvValue } from '../shared/dotenvCore'
import { masterPasswordPolicyError } from '../shared/passwordPolicy'

const OPEN_CORE_BUILD = typeof __VAULTAGE_OPEN_CORE__ !== 'undefined' && __VAULTAGE_OPEN_CORE__
const OPEN_VALID_MODES = ['local', 'agent'] as const
const FULL_VALID_MODES = ['local', 'agent', 'broker'] as const
export const VALID_MODES = OPEN_CORE_BUILD ? OPEN_VALID_MODES : FULL_VALID_MODES
export type AppMode = typeof FULL_VALID_MODES[number]

export const MAX_AGENT_BODY_BYTES = 64 * 1024
export const MAX_PENDING_REQUESTS = 8
export const MAX_ENV_ENTRIES = 128
export const MAX_ENV_VALUE_BYTES = 256 * 1024
export const MAX_AGENT_COMMAND_ARGS = 64
export const MAX_AGENT_COMMAND_ARG_LENGTH = 200
export const MAX_PASSWORD_BYTES = 4 * 1024
export const MAX_VAULT_JSON_BYTES = 10 * 1024 * 1024
export const PLAINTEXT_EXPORT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT'
export const AGENT_APPROVAL_CONFIRM_PHRASE = 'APPROVE AGENT'
export const SECRET_REVEAL_CONFIRM_PHRASE = 'REVEAL SECRET'
export const QUICK_REVEAL_PIN_RE = /^\d{4}$/
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const HTTP_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
export const AGENT_DELIVERY_MODES = ['response', 'process'] as const
export type AgentDeliveryMode = typeof AGENT_DELIVERY_MODES[number]

type HeadersLike = Record<string, string | string[] | undefined>

export interface EnvValueEntry {
  envKey: string
  value: string
}

export function isAppMode(mode: unknown): mode is AppMode {
  return typeof mode === 'string' && (VALID_MODES as readonly string[]).includes(mode)
}

export function isBrowserOriginRequest(headers: HeadersLike): boolean {
  return Boolean(
    headers.origin ||
    headers['sec-fetch-site'] ||
    headers['sec-fetch-mode'] ||
    headers['sec-fetch-dest']
  )
}

export function cleanAgentText(value: unknown, fallback: string, maxLen: number): string {
  const raw = typeof value === 'string' ? value : fallback
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return (cleaned || fallback).slice(0, maxLen)
}

export function validateProjectPath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  if (path.includes('\0')) return null
  const trimmed = path.trim()
  if (!trimmed || !isAbsolute(trimmed)) return null
  return normalize(trimmed)
}

export function validateSecretRequestPayload(payload: unknown):
  | {
      ok: true
      requestor: string
      project?: string
      keys?: string[]
      reason?: string
      delivery?: AgentDeliveryMode
      command?: string[]
    }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }

  const p = payload as Record<string, unknown>
  const requestor = cleanAgentText(p.requestor, 'Unknown agent', 120)
  const reason = typeof p.reason === 'string'
    ? cleanAgentText(p.reason, '', 500) || undefined
    : undefined

  let delivery: AgentDeliveryMode | undefined
  if (p.delivery !== undefined) {
    if (
      typeof p.delivery !== 'string' ||
      !(AGENT_DELIVERY_MODES as readonly string[]).includes(p.delivery)
    ) {
      return { ok: false, error: 'Invalid delivery mode' }
    }
    delivery = p.delivery as AgentDeliveryMode
  }

  let project: string | undefined
  if (p.project !== undefined) {
    const validProject = validateProjectPath(p.project)
    if (!validProject) return { ok: false, error: 'project must be an absolute local path' }
    project = validProject
  }

  let keys: string[] | undefined
  if (p.keys !== undefined) {
    if (!Array.isArray(p.keys)) return { ok: false, error: 'keys must be an array' }
    if (p.keys.length === 0) return { ok: false, error: 'keys must not be empty' }
    if (p.keys.length > MAX_ENV_ENTRIES) return { ok: false, error: 'too many requested keys' }
    keys = []
    for (const key of p.keys) {
      if (typeof key !== 'string' || !ENV_KEY_RE.test(key)) {
        return { ok: false, error: `Invalid env key: ${String(key)}` }
      }
      keys.push(key)
    }
    keys = [...new Set(keys)]
  }

  let command: string[] | undefined
  if (p.command !== undefined) {
    if (!Array.isArray(p.command)) return { ok: false, error: 'command must be an array' }
    if (p.command.length === 0) return { ok: false, error: 'command must not be empty' }
    if (p.command.length > MAX_AGENT_COMMAND_ARGS) return { ok: false, error: 'too many command args' }
    command = []
    for (const arg of p.command) {
      if (typeof arg !== 'string') return { ok: false, error: 'command args must be strings' }
      const cleaned = cleanAgentText(arg, '', MAX_AGENT_COMMAND_ARG_LENGTH)
      if (!cleaned) return { ok: false, error: 'command args must not be empty' }
      command.push(cleaned)
    }
  }

  return { ok: true, requestor, project, keys, reason, delivery, command }
}

export function validateEnvEntries(entries: unknown): EnvValueEntry[] {
  if (!Array.isArray(entries)) throw new Error('entries must be an array')
  if (entries.length > MAX_ENV_ENTRIES) throw new Error('too many env entries')
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Invalid env entry')
    }
    const e = entry as Record<string, unknown>
    if (typeof e.envKey !== 'string' || !ENV_KEY_RE.test(e.envKey)) {
      throw new Error(`Invalid env key: ${String(e.envKey)}`)
    }
    if (typeof e.value !== 'string') throw new Error(`Invalid value for ${e.envKey}`)
    if (Buffer.byteLength(e.value, 'utf8') > MAX_ENV_VALUE_BYTES) {
      throw new Error(`Value too large for ${e.envKey}`)
    }
    return { envKey: e.envKey, value: e.value }
  })
}

export function validatePlaintextExportConfirmation(phrase: unknown): boolean {
  return phrase === PLAINTEXT_EXPORT_CONFIRM_PHRASE
}

export function validateAgentApprovalConfirmation(phrase: unknown): boolean {
  return phrase === AGENT_APPROVAL_CONFIRM_PHRASE
}

export function validateSecretRevealConfirmation(phrase: unknown): boolean {
  return phrase === SECRET_REVEAL_CONFIRM_PHRASE
}

export function validateQuickRevealPinInput(pin: unknown, field = 'PIN'): string {
  if (typeof pin !== 'string') throw new Error(`${field} must be a string`)
  if (!QUICK_REVEAL_PIN_RE.test(pin)) throw new Error(`${field} must be exactly 4 digits`)
  return pin
}

export function validatePasswordInput(password: unknown, field = 'password'): string {
  if (typeof password !== 'string') throw new Error(`${field} must be a string`)
  if (password.length === 0) throw new Error(`${field} is required`)
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`${field} is too large`)
  }
  return password
}

export function validateMasterPasswordInput(password: unknown, field = 'password'): string {
  const safePassword = validatePasswordInput(password, field)
  const policyError = masterPasswordPolicyError(safePassword, field)
  if (policyError) throw new Error(policyError)
  return safePassword
}

export function validateVaultSaveJson(json: unknown): string {
  if (typeof json !== 'string') throw new Error('Vault payload must be a JSON string')
  if (Buffer.byteLength(json, 'utf8') > MAX_VAULT_JSON_BYTES) {
    throw new Error('Vault payload is too large')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Vault payload must be valid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vault payload must be a JSON object')
  }
  const root = parsed as Record<string, unknown>
  if (typeof root.version !== 'number') throw new Error('Vault payload version must be a number')
  if (
    root.revision !== undefined &&
    (typeof root.revision !== 'number' || !Number.isInteger(root.revision) || root.revision < 1)
  ) {
    throw new Error('Vault payload revision must be a positive integer')
  }
  if (!root.root || typeof root.root !== 'object' || Array.isArray(root.root)) {
    throw new Error('Vault payload root must be an object')
  }
  return json
}

export function serializeEnvFile(entries: EnvValueEntry[]): string {
  return formatDotenvEntries(entries, {
    header: '# Generated by Vaultage - do not commit this file',
  })
}

export function serializeDotenvValue(value: string): string {
  return formatDotenvValue(value)
}

export function validateCustomProviderBaseUrl(baseUrl: unknown): string {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('Custom provider base URL is required')
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error('Custom provider base URL is invalid')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Custom provider base URL must not include credentials')
  }

  const isHttps = parsed.protocol === 'https:'
  const isLocalHttp = parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)
  const isLocalHttps = parsed.protocol === 'https:' && isLoopbackHostname(parsed.hostname)
  if (!isHttps && !isLocalHttp) {
    throw new Error('Custom provider base URL must use HTTPS unless it targets localhost')
  }
  if (isHttps && !isLocalHttps && !isAllowedCustomProviderHost(parsed.hostname)) {
    throw new Error('Custom provider remote host is not allowed')
  }

  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function buildCustomProviderUrl(
  baseUrl: unknown,
  configuredPath: unknown,
  fallbackPath: string,
): string {
  const base = validateCustomProviderBaseUrl(baseUrl)
  const path = validateCustomProviderPath(configuredPath, fallbackPath)
  return `${base}${path}`
}

export function validateCustomProviderPath(configuredPath: unknown, fallbackPath: string): string {
  const path = typeof configuredPath === 'string' && configuredPath.trim()
    ? configuredPath.trim()
    : fallbackPath

  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error('Custom provider path contains control characters')
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.startsWith('//')) {
    throw new Error('Custom provider paths must be relative to the configured base URL')
  }
  if (!path.startsWith('/')) {
    throw new Error('Custom provider paths must start with /')
  }
  return path
}

export function validateCustomHeaderName(name: unknown, fallback = 'Authorization'): string {
  const headerName = typeof name === 'string' && name.trim() ? name.trim() : fallback
  if (!HTTP_HEADER_NAME_RE.test(headerName)) {
    throw new Error('Custom provider header name is invalid')
  }
  return headerName
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (isIP(host) === 4) return host.startsWith('127.')
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]'
  )
}

function isAllowedCustomProviderHost(hostname: string): boolean {
  const configured = process.env['VAULTAGE_CUSTOM_PROVIDER_HOSTS'] ?? ''
  if (!configured.trim()) return false
  const allowed = new Set(
    configured
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
  )
  return allowed.has(hostname.toLowerCase())
}
