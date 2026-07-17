import { Buffer } from 'buffer'
import { createHash, timingSafeEqual } from 'crypto'
import { validateQuickRevealPinAttemptInput } from './security'
import {
  currentScryptParams,
  KEY_LENGTH,
  randomSalt,
  scrypt,
  SCRYPT_MAXMEM,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  type ScryptParams,
} from './vaultCrypto'
import { isRecord } from './vaultIpcCommon'

export function optionalQuickRevealPin(pin: unknown): string | undefined {
  if (pin === undefined || pin === null || pin === '') return undefined
  return validateQuickRevealPinAttemptInput(pin)
}

interface PinAttemptState {
  failures: number
  blockedUntil: number
  pending: boolean
  lastTouched: number
}

export interface PersistedPinAttemptState {
  failures: number
  blockedUntil: number
  lastTouched: number
}

export interface QuickRevealPinThrottleStore {
  load(key: string): Promise<PersistedPinAttemptState | null>
  save(key: string, state: PersistedPinAttemptState): Promise<void>
  clear(key: string): Promise<void>
  clearAll(): Promise<void>
}

const pinAttempts = new Map<string, PinAttemptState>()
const PIN_BACKOFF_START = 5
const PIN_MAX_FAILURES = 10
const MAX_PIN_BACKOFF_MS = 60 * 60 * 1000
let throttleStore: QuickRevealPinThrottleStore | null = null
let throttleStoreHealthy = true
let throttleGeneration = 0

export function configureQuickRevealPinThrottleStore(store: QuickRevealPinThrottleStore | null): void {
  throttleStore = store
  throttleStoreHealthy = true
  throttleGeneration += 1
  pinAttempts.clear()
}

export async function createQuickRevealPinRecord(pin: string): Promise<QuickRevealPinRecord> {
  const salt = randomSalt()
  const params = currentScryptParams()
  const verifier = await deriveQuickRevealPin(pin, salt, params)
  try {
    return {
      version: 1,
      scrypt: { ...params, salt: salt.toString('hex') },
      verifier: verifier.toString('hex'),
      updatedAt: new Date().toISOString(),
    }
  } finally {
    verifier.fill(0)
  }
}

export async function requireQuickRevealPin(vault: unknown, pin: string): Promise<void> {
  if (throttleStore && !throttleStoreHealthy) {
    throw new Error('Reveal PIN persistence is unavailable. Use Touch ID or master-password confirmation')
  }
  const record = quickRevealPinRecord(vault)
  if (!record) throw new Error('Reveal PIN is not configured')
  const attemptKey = createHash('sha256').update(`${record.scrypt.salt}:${record.verifier}`).digest('hex')
  const now = Date.now()
  const existingAttempt = pinAttempts.get(attemptKey)
  if (existingAttempt?.pending) throw new Error('A reveal PIN check is already in progress')
  const attempt = existingAttempt ?? {
    failures: 0,
    blockedUntil: 0,
    pending: true,
    lastTouched: now,
  }
  prunePinAttempts(now)
  attempt.pending = true
  pinAttempts.set(attemptKey, attempt)
  const generation = throttleGeneration
  if (!existingAttempt && throttleStore) {
    let persisted: PersistedPinAttemptState | null
    try {
      persisted = await throttleStore.load(attemptKey)
    } catch {
      attempt.pending = false
      throttleStoreHealthy = false
      throw new Error('Reveal PIN persistence is unavailable. Use Touch ID or master-password confirmation')
    }
    if (persisted) {
      attempt.failures = persisted.failures
      attempt.blockedUntil = persisted.blockedUntil
      attempt.lastTouched = persisted.lastTouched
    }
  }
  if (attempt.blockedUntil > now) {
    attempt.pending = false
    if (attempt.failures >= PIN_MAX_FAILURES) {
      throw new Error('Reveal PIN disabled after too many attempts. Use Touch ID or master-password confirmation')
    }
    const seconds = Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000))
    throw new Error(`Reveal PIN temporarily locked. Use Touch ID or try again in ${seconds} seconds`)
  }
  attempt.lastTouched = now
  const expected = Buffer.from(record.verifier, 'hex')
  let actual: Buffer | null = null
  let matched = false
  try {
    actual = await deriveQuickRevealPin(pin, Buffer.from(record.scrypt.salt, 'hex'), record.scrypt)
    if (generation !== throttleGeneration) {
      throw new Error('Reveal PIN state changed during verification. Use Touch ID or try again')
    }
    if (expected.byteLength === 0 || expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
      attempt.failures += 1
      if (attempt.failures >= PIN_MAX_FAILURES) {
        attempt.blockedUntil = Number.MAX_SAFE_INTEGER
        throw new Error('Reveal PIN disabled after too many attempts. Use Touch ID or master-password confirmation')
      } else if (attempt.failures >= PIN_BACKOFF_START) {
        const exponent = Math.min(7, attempt.failures - PIN_BACKOFF_START)
        attempt.blockedUntil = Date.now() + Math.min(MAX_PIN_BACKOFF_MS, 30_000 * (2 ** exponent))
      }
      throw new Error('Incorrect PIN')
    }
    matched = true
    pinAttempts.delete(attemptKey)
    if (throttleStore) {
      try {
        await throttleStore.clear(attemptKey)
      } catch {
        throttleStoreHealthy = false
      }
    }
  } finally {
    attempt.pending = false
    attempt.lastTouched = Date.now()
    if (!matched && attempt.failures > 0 && generation === throttleGeneration && throttleStore) {
      try {
        await throttleStore.save(attemptKey, {
          failures: attempt.failures,
          blockedUntil: attempt.blockedUntil,
          lastTouched: attempt.lastTouched,
        })
      } catch {
        // Keep the in-memory ceiling and disable all further PIN attempts. A
        // best-effort persistence failure must never silently reset throttling.
        throttleStoreHealthy = false
        attempt.blockedUntil = Number.MAX_SAFE_INTEGER
      }
    }
    expected.fill(0)
    actual?.fill(0)
  }
}

export function resetQuickRevealPinThrottle(): void {
  throttleGeneration += 1
  const generation = throttleGeneration
  pinAttempts.clear()
  if (!throttleStore) {
    throttleStoreHealthy = true
    return
  }
  // Fail closed until the user-presence-authorized reset is durable. The
  // generation check prevents an older reset or PIN attempt from winning later.
  throttleStoreHealthy = false
  void throttleStore.clearAll().then(() => {
    if (generation === throttleGeneration) throttleStoreHealthy = true
  }).catch(() => {
    if (generation === throttleGeneration) throttleStoreHealthy = false
  })
}

function prunePinAttempts(now: number): void {
  const staleBefore = now - 24 * 60 * 60 * 1000
  for (const [key, state] of pinAttempts) {
    if (!state.pending && state.lastTouched < staleBefore) pinAttempts.delete(key)
  }
}

export function hasQuickRevealPin(vault: unknown): boolean {
  return quickRevealPinRecord(vault) !== null
}

async function deriveQuickRevealPin(pin: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return scrypt(`vaultage quick reveal pin:${pin}`, salt, params)
}

function quickRevealPinRecord(vault: unknown): QuickRevealPinRecord | null {
  if (!isRecord(vault) || !isRecord(vault.preferences) || !isRecord(vault.preferences.quickRevealPin)) return null
  const record = vault.preferences.quickRevealPin
  if (record.version !== 1 || typeof record.verifier !== 'string' || !/^[0-9a-f]+$/i.test(record.verifier)) return null
  return {
    version: 1,
    scrypt: quickRevealPinKdf(record.scrypt),
    verifier: record.verifier,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function quickRevealPinKdf(value: unknown): QuickRevealPinKdf {
  if (!isRecord(value)) throw new Error('Reveal PIN verifier is invalid')
  const salt = typeof value.salt === 'string' && /^[0-9a-f]+$/i.test(value.salt) && value.salt.length % 2 === 0
    ? value.salt
    : null
  if (!salt || salt.length < 16 || salt.length > 128) throw new Error('Reveal PIN verifier is invalid')
  const N = quickRevealPinPositiveInteger(value.N, SCRYPT_N)
  const r = quickRevealPinPositiveInteger(value.r, SCRYPT_R)
  const p = quickRevealPinPositiveInteger(value.p, SCRYPT_P)
  const keylen = quickRevealPinPositiveInteger(value.keylen, KEY_LENGTH)
  if ((N & (N - 1)) !== 0 || 128 * N * r > SCRYPT_MAXMEM / 2 || keylen !== KEY_LENGTH) {
    throw new Error('Reveal PIN verifier is invalid')
  }
  return {
    N,
    r,
    p,
    keylen,
    salt,
  }
}

function quickRevealPinPositiveInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error('Reveal PIN verifier is invalid')
  }
  return value
}

interface QuickRevealPinKdf extends Required<ScryptParams> {
  salt: string
}

export interface QuickRevealPinRecord {
  version: 1
  scrypt: QuickRevealPinKdf
  verifier: string
  updatedAt?: string
}
