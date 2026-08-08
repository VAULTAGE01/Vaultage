import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  createRecoveryKit,
  decodeRecoveryCode,
  encodeRecoveryCode,
  markRecoveryKitVerified,
  metadataForRecoveryEnvelope,
  parseRecoveryEnvelope,
  RECOVERY_SECRET_BYTES,
  unwrapRecoveryKit,
  vaultFingerprintForKey,
  type RecoveryKitCrypto,
} from './recoveryKit'
import { openWithAad, sealWithAad, type ScryptParams } from './vaultCrypto'

const VAULT_KEY = Buffer.alloc(32, 0x42)
const SECRET = Buffer.from(Array.from({ length: RECOVERY_SECRET_BYTES }, (_, index) => index + 1))
const SALT = Buffer.alloc(32, 0x91)

describe('offline recovery kit', () => {
  it('encodes a versioned, grouped, transcription-safe code with checksum', () => {
    const code = encodeRecoveryCode(SECRET)

    expect(code).toMatch(/^VLT1-[0-9A-HJKMNPQRSTVWXYZ]{5}(?:-[0-9A-HJKMNPQRSTVWXYZ]{5}){8}$/u)
    expect(decodeRecoveryCode(code.toLowerCase().replaceAll('-', ' '))).toEqual(SECRET)
    expect(code.slice('VLT1-'.length)).not.toMatch(/[ILOU]/u)

    const changed = `${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`
    expect(() => decodeRecoveryCode(changed)).toThrow(/checksum|padding/u)
    expect(() => decodeRecoveryCode(code.replace('A', 'I'))).toThrow(/invalid character/u)
  })

  it('wraps the same vault key and binds the envelope to its metadata and fingerprint', async () => {
    const crypto = deterministicCrypto()
    const { envelope, material } = await createRecoveryKit(VAULT_KEY, crypto)

    expect(material.recoveryCode).toBe(encodeRecoveryCode(SECRET))
    expect(material.vaultFingerprint).toBe(vaultFingerprintForKey(VAULT_KEY))
    await expect(unwrapRecoveryKit(envelope, material.recoveryCode, crypto)).resolves.toEqual(VAULT_KEY)

    await expect(unwrapRecoveryKit({
      ...envelope,
      generation: 'different-generation',
    }, material.recoveryCode, crypto)).rejects.toThrow()
    await expect(unwrapRecoveryKit({
      ...envelope,
      vaultFingerprint: '0000-0000-0000-0000',
    }, material.recoveryCode, crypto)).rejects.toThrow()
    await expect(unwrapRecoveryKit(envelope, encodeRecoveryCode(Buffer.alloc(RECOVERY_SECRET_BYTES, 7)), crypto))
      .rejects.toThrow()
  })

  it('validates bounded persisted metadata and records verification without exposing the code', async () => {
    const { envelope } = await createRecoveryKit(VAULT_KEY, deterministicCrypto())
    const verified = markRecoveryKitVerified(envelope, '2026-08-02T12:30:00.000Z')

    expect(metadataForRecoveryEnvelope(verified)).toEqual({
      format: 'vaultage.recovery-kit.v1',
      generation: 'generation-1',
      createdAt: '2026-08-02T12:00:00.000Z',
      verifiedAt: '2026-08-02T12:30:00.000Z',
      vaultFingerprint: vaultFingerprintForKey(VAULT_KEY),
    })
    expect(metadataForRecoveryEnvelope(verified)).not.toHaveProperty('wrappedVaultKey')
    expect(() => parseRecoveryEnvelope({
      ...envelope,
      kdf: { ...envelope.kdf, N: envelope.kdf.N * 2 },
    })).toThrow(/scrypt N/u)
    expect(() => parseRecoveryEnvelope({ ...envelope, wrappedVaultKey: 'AAAA' })).toThrow(/wrapped/u)
  })
})

function deterministicCrypto(): RecoveryKitCrypto {
  let randomCall = 0
  return {
    randomBytes: (length) => {
      randomCall += 1
      const source = randomCall === 1 ? SECRET : SALT
      if (source.length !== length) throw new Error('Unexpected random length')
      return Buffer.from(source)
    },
    randomId: () => 'generation-1',
    now: () => '2026-08-02T12:00:00.000Z',
    scrypt: async (secret, salt, params) => fakeDerivedKey(secret, salt, params),
    sealWithAad,
    openWithAad,
  }
}

function fakeDerivedKey(secret: string, salt: Buffer, params: ScryptParams): Buffer {
  return createHash('sha256')
    .update(secret)
    .update(salt)
    .update(`${params.N}:${params.r}:${params.p}:${params.keylen ?? 32}`)
    .digest()
}
