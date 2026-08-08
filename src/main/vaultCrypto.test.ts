import { describe, expect, it } from 'vitest'
import { open, openWithAad, randomVaultKey, sameKey, seal, sealWithAad } from './vaultCrypto'

describe('vault crypto envelope', () => {
  it('round-trips AES-GCM sealed payloads', () => {
    const key = randomVaultKey()
    const plain = Buffer.from('{"version":2,"root":{"id":"root"}}', 'utf8')

    const sealed = seal(plain, key)

    expect(sealed).not.toEqual(plain)
    expect(open(sealed, key)).toEqual(plain)
  })

  it('rejects tampered payloads and wrong keys', () => {
    const key = randomVaultKey()
    const sealed = seal(Buffer.from('secret'), key)
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 1] ^= 1

    expect(() => open(tampered, key)).toThrow()
    expect(() => open(sealed, randomVaultKey())).toThrow()
  })

  it('authenticates recovery-envelope metadata as AES-GCM additional data', () => {
    const key = randomVaultKey()
    const aad = Buffer.from('vaultage.recovery-kit.v1\0generation-a\0fingerprint-a')
    const sealed = sealWithAad(Buffer.from('wrapped-vault-key'), key, aad)

    expect(openWithAad(sealed, key, aad)).toEqual(Buffer.from('wrapped-vault-key'))
    expect(() => openWithAad(sealed, key, Buffer.from('different-generation'))).toThrow()
    expect(() => open(sealed, key)).toThrow()
  })

  it('compares vault keys without accepting length mismatches', () => {
    const key = randomVaultKey()

    expect(sameKey(key, Buffer.from(key))).toBe(true)
    expect(sameKey(key, Buffer.concat([key, Buffer.from([0])]))).toBe(false)
  })
})
