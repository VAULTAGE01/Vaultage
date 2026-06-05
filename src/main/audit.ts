import { createHash, createHmac, randomUUID } from 'crypto'
import { dirname } from 'path'
import { promises as fs } from 'fs'

export type AuditEventType =
  | 'vault.setup'
  | 'vault.unlock'
  | 'vault.lock'
  | 'mode.change'
  | 'agent_api.enabled'
  | 'agent_api.disabled'
  | 'agent.request.received'
  | 'agent.request.approved'
  | 'agent.request.denied'
  | 'agent.request.expired'
  | 'agent.request.cancelled'
  | 'vault.secret.copied'
  | 'vault.secret.revealed'
  | 'vault.reveal_pin.changed'
  | 'env.exported'
  | 'vault.exported_json'
  | 'vault.exported_plaintext'
  | 'vault.exported_encrypted'
  | 'audit.exported'
  | 'provider.action'

export interface AuditEvent {
  id: string
  timestamp: string
  type: AuditEventType
  details: AuditDetails
  previousHash: string | null
  hashScheme?: 'sha256' | 'hmac-sha256'
  hash: string
}

export type AuditDetails = Record<string, AuditValue>
type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue }

const REDACTED = '[redacted]'
const MAX_AUDIT_STRING = 512
const SENSITIVE_DETAIL_KEY_RE = /(secret|token|password|authorization|credential|value)/i
const AUDIT_MAC_CONTEXT = 'vaultage audit log v1'

export type AuditMacKey = Buffer | Uint8Array | string

export function createAuditEvent(
  type: AuditEventType,
  details: Record<string, unknown> = {},
  previousHash: string | null = null,
  timestamp = new Date().toISOString(),
  id: string = randomUUID(),
  macKey?: AuditMacKey,
): AuditEvent {
  const eventWithoutHash = {
    id,
    timestamp,
    type,
    details: sanitizeAuditDetails(details),
    previousHash,
    hashScheme: macKey ? 'hmac-sha256' as const : 'sha256' as const,
  }
  return {
    ...eventWithoutHash,
    hash: hashAuditRecord(eventWithoutHash, macKey),
  }
}

export async function appendAuditEvent(
  filePath: string,
  type: AuditEventType,
  details: Record<string, unknown> = {},
  macKey?: AuditMacKey,
): Promise<AuditEvent> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const previousHash = await readLastAuditHash(filePath)
  const event = createAuditEvent(type, details, previousHash, undefined, undefined, macKey)
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
  return event
}

export async function readAuditLog(filePath: string): Promise<AuditEvent[]> {
  try {
    return parseAuditLog(await fs.readFile(filePath, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export function parseAuditLog(raw: string): AuditEvent[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEvent)
}

export function verifyAuditChain(
  events: AuditEvent[],
  options: { macKey?: AuditMacKey; requireMac?: boolean } = {},
): { ok: true } | { ok: false; index: number; reason: string } {
  let previousHash: string | null = null
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event.previousHash !== previousHash) {
      return { ok: false, index: i, reason: 'previous hash mismatch' }
    }
    const { hash, ...withoutHash } = event
    const scheme = event.hashScheme ?? 'sha256'
    if (options.requireMac && scheme !== 'hmac-sha256') {
      return { ok: false, index: i, reason: 'event MAC missing' }
    }
    if (scheme === 'hmac-sha256' && !options.macKey) {
      return { ok: false, index: i, reason: 'event MAC key unavailable' }
    }
    const expectedHash = hashAuditRecord(withoutHash, scheme === 'hmac-sha256' ? options.macKey : undefined)
    if (expectedHash !== hash) {
      return { ok: false, index: i, reason: 'event hash mismatch' }
    }
    previousHash = hash
  }
  return { ok: true }
}

export function sanitizeAuditDetails(details: Record<string, unknown>): AuditDetails {
  return sanitizeAuditValue(details, '') as AuditDetails
}

export function deriveAuditMacKey(vaultKey: Buffer): Buffer {
  return createHmac('sha256', vaultKey).update(AUDIT_MAC_CONTEXT).digest()
}

export function hashAuditRecord(record: Omit<AuditEvent, 'hash'>, macKey?: AuditMacKey): string {
  const json = stableJson(record)
  if (macKey) return createHmac('sha256', macKey).update(json).digest('hex')
  return createHash('sha256').update(json).digest('hex')
}

async function readLastAuditHash(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
    if (lines.length === 0) return null
    const last = JSON.parse(lines[lines.length - 1]) as AuditEvent
    return typeof last.hash === 'string' ? last.hash : null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function sanitizeAuditValue(value: unknown, key: string): AuditValue {
  if (SENSITIVE_DETAIL_KEY_RE.test(key)) return REDACTED
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    return value.length > MAX_AUDIT_STRING ? `${value.slice(0, MAX_AUDIT_STRING)}...` : value
  }
  if (Array.isArray(value)) return value.map(item => sanitizeAuditValue(item, key))
  if (value && typeof value === 'object') {
    const out: Record<string, AuditValue> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = sanitizeAuditValue(childValue, childKey)
    }
    return out
  }
  return String(value)
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
  return `{${entries.join(',')}}`
}
