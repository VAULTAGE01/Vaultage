import { describe, expect, it } from 'vitest'
import { VaultSessionChangedError, VaultSessionKeyring, leaseVaultKey } from './vaultSessionKey'

describe('VaultSessionKeyring', () => {
  it('invalidates immediately without zeroing a leased key that is still in use', async () => {
    const session = new VaultSessionKeyring()
    const operation = session.beginOperation()
    if (!operation) throw new Error('operation unavailable')
    const source = Buffer.from('leased-vault-key')
    expect(session.installKey(source, operation.epoch)).toBe(true)
    operation.release()

    const liveKey = session.currentKey()
    if (!liveKey) throw new Error('key unavailable')
    const lease = leaseVaultKey(liveKey)
    const leasedBytes = Buffer.from(lease.key)

    let invalidationSettled = false
    const invalidation = session.invalidate().then((wasUnlocked) => {
      invalidationSettled = true
      return wasUnlocked
    })

    expect(session.currentKey()).toBeNull()
    expect(session.isUnlocked()).toBe(false)
    expect(lease.key.equals(leasedBytes)).toBe(true)
    expect(() => lease.assertCurrent()).toThrow(VaultSessionChangedError)
    await Promise.resolve()
    expect(invalidationSettled).toBe(false)

    lease.release()
    await expect(invalidation).resolves.toBe(true)
    expect(lease.key.equals(Buffer.alloc(lease.key.length))).toBe(true)
  })

  it('rejects a stale branded key after a new session is installed', async () => {
    const session = new VaultSessionKeyring()
    const first = session.beginOperation()!
    session.installKey(Buffer.from('first-vault-key'), first.epoch)
    first.release()
    const stale = session.currentKey()!

    await session.invalidate()
    const second = session.beginOperation()!
    session.installKey(Buffer.from('second-vault-key'), second.epoch)
    second.release()

    expect(() => leaseVaultKey(stale)).toThrow(VaultSessionChangedError)
  })

  it('prevents an older async unlock from replacing a newer session', () => {
    const session = new VaultSessionKeyring()
    const older = session.beginOperation()!
    const newer = session.beginOperation()!

    expect(session.installKey(Buffer.from('newer-key'), newer.epoch)).toBe(true)
    expect(session.installKey(Buffer.from('older-key'), older.epoch)).toBe(false)
    newer.release()
    older.release()

    expect(session.currentKey()?.toString()).toBe('newer-key')
  })
})
