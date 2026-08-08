import { createHash, randomBytes, randomUUID } from 'crypto'
import {
  currentScryptParams,
  KEY_LENGTH,
  openWithAad,
  scrypt,
  sealWithAad,
  type ScryptParams,
} from './vaultCrypto'

export const RECOVERY_KIT_FORMAT = 'vaultage.recovery-kit.v1'
export const RECOVERY_CODE_PREFIX = 'VLT1'
export const RECOVERY_SECRET_BYTES = 24
export const RECOVERY_CHECKSUM_BYTES = 4
export const RECOVERY_CODE_GROUP_SIZE = 5

const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_CODE_BODY_LENGTH = Math.ceil(
  ((RECOVERY_SECRET_BYTES + RECOVERY_CHECKSUM_BYTES) * 8) / 5,
)
const RECOVERY_CODE_DOMAIN = Buffer.from('vaultage.recovery-code.v1\0', 'utf8')
const RECOVERY_FINGERPRINT_DOMAIN = Buffer.from('vaultage.vault-fingerprint.v1\0', 'utf8')
const RECOVERY_AAD_DOMAIN = 'vaultage.recovery-envelope.aad.v1'

export interface RecoveryKitEnvelope {
  format: typeof RECOVERY_KIT_FORMAT
  generation: string
  createdAt: string
  verifiedAt?: string
  vaultFingerprint: string
  kdf: {
    name: 'scrypt'
    N: number
    r: number
    p: number
    keylen: number
    salt: string
  }
  wrappedVaultKey: string
}

export interface RecoveryKitMetadata {
  format: typeof RECOVERY_KIT_FORMAT
  generation: string
  createdAt: string
  verifiedAt?: string
  vaultFingerprint: string
}

export interface RecoveryKitMaterial extends RecoveryKitMetadata {
  recoveryCode: string
}

export interface RecoveryKitCrypto {
  randomBytes(length: number): Buffer
  randomId(): string
  now(): string
  scrypt(secret: string, salt: Buffer, params: ScryptParams): Promise<Buffer>
  sealWithAad(plain: Buffer, key: Buffer, aad: Buffer): Buffer
  openWithAad(blob: Buffer, key: Buffer, aad: Buffer): Buffer
}

const productionCrypto: RecoveryKitCrypto = {
  randomBytes,
  randomId: randomUUID,
  now: () => new Date().toISOString(),
  scrypt,
  sealWithAad,
  openWithAad,
}

export async function createRecoveryKit(
  vaultKey: Buffer,
  crypto: RecoveryKitCrypto = productionCrypto,
): Promise<{ envelope: RecoveryKitEnvelope; material: RecoveryKitMaterial }> {
  requireVaultKey(vaultKey)
  const secret = crypto.randomBytes(RECOVERY_SECRET_BYTES)
  const salt = crypto.randomBytes(32)
  let wrappingKey: Buffer | null = null
  try {
    if (secret.length !== RECOVERY_SECRET_BYTES) throw new Error('Invalid recovery entropy source')
    if (salt.length !== 32) throw new Error('Invalid recovery salt source')
    const recoveryCode = encodeRecoveryCode(secret)
    const generation = requireGeneration(crypto.randomId())
    const createdAt = requireIsoTimestamp(crypto.now(), 'recovery creation time')
    const vaultFingerprint = vaultFingerprintForKey(vaultKey)
    const params = currentScryptParams()
    const kdf: RecoveryKitEnvelope['kdf'] = {
      name: 'scrypt',
      ...params,
      salt: salt.toString('hex'),
    }
    wrappingKey = await crypto.scrypt(secret.toString('base64url'), salt, params)
    const aad = recoveryEnvelopeAad({
      generation,
      createdAt,
      vaultFingerprint,
      kdf,
    })
    const wrappedVaultKey = crypto.sealWithAad(vaultKey, wrappingKey, aad).toString('base64')
    const envelope: RecoveryKitEnvelope = {
      format: RECOVERY_KIT_FORMAT,
      generation,
      createdAt,
      vaultFingerprint,
      kdf,
      wrappedVaultKey,
    }
    return {
      envelope,
      material: { ...metadataForRecoveryEnvelope(envelope), recoveryCode },
    }
  } finally {
    secret.fill(0)
    wrappingKey?.fill(0)
  }
}

export async function unwrapRecoveryKit(
  envelopeValue: unknown,
  recoveryCode: string,
  crypto: RecoveryKitCrypto = productionCrypto,
): Promise<Buffer> {
  const envelope = parseRecoveryEnvelope(envelopeValue)
  const secret = decodeRecoveryCode(recoveryCode)
  let wrappingKey: Buffer | null = null
  try {
    const params = recoveryScryptParams(envelope.kdf)
    wrappingKey = await crypto.scrypt(
      secret.toString('base64url'),
      Buffer.from(envelope.kdf.salt, 'hex'),
      params,
    )
    const vaultKey = crypto.openWithAad(
      Buffer.from(envelope.wrappedVaultKey, 'base64'),
      wrappingKey,
      recoveryEnvelopeAad(envelope),
    )
    requireVaultKey(vaultKey)
    if (vaultFingerprintForKey(vaultKey) !== envelope.vaultFingerprint) {
      vaultKey.fill(0)
      throw new Error('Recovery kit does not match this vault')
    }
    return vaultKey
  } finally {
    secret.fill(0)
    wrappingKey?.fill(0)
  }
}

export function markRecoveryKitVerified(
  envelopeValue: unknown,
  verifiedAt = new Date().toISOString(),
): RecoveryKitEnvelope {
  const envelope = parseRecoveryEnvelope(envelopeValue)
  return {
    ...envelope,
    verifiedAt: requireIsoTimestamp(verifiedAt, 'recovery verification time'),
  }
}

export function metadataForRecoveryEnvelope(envelopeValue: unknown): RecoveryKitMetadata {
  const envelope = parseRecoveryEnvelope(envelopeValue)
  return {
    format: RECOVERY_KIT_FORMAT,
    generation: envelope.generation,
    createdAt: envelope.createdAt,
    ...(envelope.verifiedAt ? { verifiedAt: envelope.verifiedAt } : {}),
    vaultFingerprint: envelope.vaultFingerprint,
  }
}

export function parseRecoveryEnvelope(value: unknown): RecoveryKitEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid recovery envelope')
  }
  const record = value as Record<string, unknown>
  if (record.format !== RECOVERY_KIT_FORMAT) throw new Error('Unsupported recovery envelope format')
  const generation = requireGeneration(record.generation)
  const createdAt = requireIsoTimestamp(record.createdAt, 'recovery creation time')
  const verifiedAt = record.verifiedAt === undefined
    ? undefined
    : requireIsoTimestamp(record.verifiedAt, 'recovery verification time')
  const vaultFingerprint = requireVaultFingerprint(record.vaultFingerprint)
  const kdf = parseRecoveryKdf(record.kdf)
  const wrappedVaultKey = requireBase64(record.wrappedVaultKey, 'wrapped recovery vault key')
  const wrappedBytes = Buffer.from(wrappedVaultKey, 'base64')
  if (wrappedBytes.length !== 28 + KEY_LENGTH) throw new Error('Invalid wrapped recovery vault key')
  return {
    format: RECOVERY_KIT_FORMAT,
    generation,
    createdAt,
    ...(verifiedAt ? { verifiedAt } : {}),
    vaultFingerprint,
    kdf,
    wrappedVaultKey,
  }
}

export function serializeRecoveryEnvelope(envelopeValue: unknown): string {
  return `${JSON.stringify(parseRecoveryEnvelope(envelopeValue), null, 2)}\n`
}

export function encodeRecoveryCode(secret: Buffer): string {
  if (secret.length !== RECOVERY_SECRET_BYTES) throw new Error('Invalid recovery secret length')
  const checksum = recoveryChecksum(secret)
  const body = encodeBase32(Buffer.concat([secret, checksum]))
  if (body.length !== RECOVERY_CODE_BODY_LENGTH) throw new Error('Invalid recovery code length')
  return `${RECOVERY_CODE_PREFIX}-${groupCode(body)}`
}

export function decodeRecoveryCode(value: unknown): Buffer {
  if (typeof value !== 'string') throw new Error('Recovery code is required')
  const compact = value.trim().toUpperCase().replace(/[\s-]/gu, '')
  const expectedLength = RECOVERY_CODE_PREFIX.length + RECOVERY_CODE_BODY_LENGTH
  if (compact.length !== expectedLength || !compact.startsWith(RECOVERY_CODE_PREFIX)) {
    throw new Error('Recovery code has an invalid format')
  }
  const encoded = compact.slice(RECOVERY_CODE_PREFIX.length)
  const decoded = decodeBase32(encoded)
  if (decoded.length !== RECOVERY_SECRET_BYTES + RECOVERY_CHECKSUM_BYTES) {
    decoded.fill(0)
    throw new Error('Recovery code has an invalid length')
  }
  const secret = Buffer.from(decoded.subarray(0, RECOVERY_SECRET_BYTES))
  const expected = recoveryChecksum(secret)
  const actual = decoded.subarray(RECOVERY_SECRET_BYTES)
  const matches = actual.length === expected.length && actual.equals(expected)
  decoded.fill(0)
  expected.fill(0)
  if (!matches) {
    secret.fill(0)
    throw new Error('Recovery code checksum is invalid')
  }
  return secret
}

export function canonicalRecoveryCode(value: unknown): string {
  const secret = decodeRecoveryCode(value)
  try {
    return encodeRecoveryCode(secret)
  } finally {
    secret.fill(0)
  }
}

export function vaultFingerprintForKey(vaultKey: Buffer): string {
  requireVaultKey(vaultKey)
  const digest = createHash('sha256')
    .update(RECOVERY_FINGERPRINT_DOMAIN)
    .update(vaultKey)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()
  return digest.match(/.{1,4}/gu)?.join('-') ?? digest
}

function recoveryEnvelopeAad(input: Pick<RecoveryKitEnvelope, 'generation' | 'createdAt' | 'vaultFingerprint' | 'kdf'>): Buffer {
  return Buffer.from([
    RECOVERY_AAD_DOMAIN,
    RECOVERY_KIT_FORMAT,
    input.generation,
    input.createdAt,
    input.vaultFingerprint,
    input.kdf.name,
    String(input.kdf.N),
    String(input.kdf.r),
    String(input.kdf.p),
    String(input.kdf.keylen),
    input.kdf.salt,
  ].join('\0'), 'utf8')
}

function recoveryChecksum(secret: Buffer): Buffer {
  return createHash('sha256')
    .update(RECOVERY_CODE_DOMAIN)
    .update(secret)
    .digest()
    .subarray(0, RECOVERY_CHECKSUM_BYTES)
}

function groupCode(value: string): string {
  return value.match(new RegExp(`.{1,${RECOVERY_CODE_GROUP_SIZE}}`, 'gu'))?.join('-') ?? value
}

function encodeBase32(value: Buffer): string {
  let accumulator = 0
  let bits = 0
  let output = ''
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += RECOVERY_ALPHABET[(accumulator >>> bits) & 31]
      accumulator &= (1 << bits) - 1
    }
  }
  if (bits > 0) output += RECOVERY_ALPHABET[(accumulator << (5 - bits)) & 31]
  return output
}

function decodeBase32(value: string): Buffer {
  let accumulator = 0
  let bits = 0
  const bytes: number[] = []
  for (const character of value) {
    const digit = RECOVERY_ALPHABET.indexOf(character)
    if (digit < 0) throw new Error('Recovery code contains an invalid character')
    accumulator = (accumulator << 5) | digit
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
      accumulator &= (1 << bits) - 1
    }
  }
  if (bits > 0 && accumulator !== 0) throw new Error('Recovery code has invalid padding')
  return Buffer.from(bytes)
}

function parseRecoveryKdf(value: unknown): RecoveryKitEnvelope['kdf'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid recovery KDF')
  }
  const record = value as Record<string, unknown>
  if (record.name !== 'scrypt') throw new Error('Unsupported recovery KDF')
  const current = currentScryptParams()
  const N = boundedInteger(record.N, 'recovery scrypt N', current.N)
  const r = boundedInteger(record.r, 'recovery scrypt r', current.r)
  const p = boundedInteger(record.p, 'recovery scrypt p', current.p)
  const keylen = boundedInteger(record.keylen, 'recovery scrypt key length', KEY_LENGTH)
  if (N < 2 || (N & (N - 1)) !== 0) throw new Error('Invalid recovery scrypt N')
  if (keylen !== KEY_LENGTH) throw new Error('Invalid recovery scrypt key length')
  const salt = requireHex(record.salt, 'recovery scrypt salt')
  if (salt.length !== 64) throw new Error('Invalid recovery scrypt salt')
  return { name: 'scrypt', N, r, p, keylen, salt }
}

function recoveryScryptParams(kdf: RecoveryKitEnvelope['kdf']): Required<ScryptParams> {
  return { N: kdf.N, r: kdf.r, p: kdf.p, keylen: kdf.keylen }
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function requireVaultKey(value: Buffer): void {
  if (!Buffer.isBuffer(value) || value.length !== KEY_LENGTH) throw new Error('Invalid vault key')
}

function requireGeneration(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,80}$/u.test(value)) {
    throw new Error('Invalid recovery generation')
  }
  return value
}

function requireIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function requireVaultFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/u.test(value)) {
    throw new Error('Invalid recovery vault fingerprint')
  }
  return value
}

function requireBase64(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function requireHex(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value.toLowerCase()
}
