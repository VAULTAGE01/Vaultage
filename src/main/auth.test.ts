import { describe, expect, it } from 'vitest'
import type { AuditEventType } from './audit'
import { AuthController, type AuthCrypto, type AuthStorage } from './auth'
import type { KeychainResult } from './keychain'
import { currentScryptParams, type ScryptParams } from './vaultCrypto'

describe('AuthController', () => {
  it('sets up a new vault and unlocks it with the master password', async () => {
    const h = makeHarness()

    await expect(h.auth.status()).resolves.toEqual({ needsSetup: true })

    const setup = await h.auth.setup('correct horse battery staple')
    if (!setup.success) throw new Error(setup.error)
    expect(setup.data).toEqual({
      version: 2,
      root: {
        id: 'root-id',
        name: 'My Vault',
        children: [
          { id: 'root-id-passwords', name: 'Passwords', children: [], secrets: [], itemOrder: [] },
          { id: 'root-id-api-keys', name: 'API Keys', children: [], secrets: [], itemOrder: [] },
          { id: 'root-id-tokens', name: 'Tokens', children: [], secrets: [], itemOrder: [] },
          { id: 'root-id-secure-notes', name: 'Secure Notes', children: [], secrets: [], itemOrder: [] },
          { id: 'root-id-ssh-keys', name: 'SSH Keys', children: [], secrets: [], itemOrder: [] },
          { id: 'root-id-images', name: 'Images', children: [], secrets: [], itemOrder: [] },
        ],
        secrets: [],
        itemOrder: [
          { kind: 'folder', id: 'root-id-passwords' },
          { kind: 'folder', id: 'root-id-api-keys' },
          { kind: 'folder', id: 'root-id-tokens' },
          { kind: 'folder', id: 'root-id-secure-notes' },
          { kind: 'folder', id: 'root-id-ssh-keys' },
          { kind: 'folder', id: 'root-id-images' },
        ],
      },
      preferences: { localDefaultFoldersCreated: true },
    })
    expectBufferEquals(h.vaultKey, VAULT_KEY)
    expect(h.keychainStores).toEqual([VAULT_KEY.toString('hex')])
    expect(h.auditEvents).toEqual([{ type: 'vault.setup', details: { method: 'password' } }])
    await expect(h.auth.status()).resolves.toEqual({ needsSetup: false })

    h.vaultKey = null
    await expect(h.auth.unlockWithPassword('wrong password')).resolves.toEqual({
      success: false,
      wrongPassword: true,
      error: 'Incorrect master password',
    })

    const unlock = await h.auth.unlockWithPassword('correct horse battery staple')
    if (!unlock.success) throw new Error(unlock.error)
    expect(unlock.data).toEqual(setup.data)
    expectBufferEquals(h.vaultKey, VAULT_KEY)
    expect(h.auditEvents.at(-1)).toEqual({
      type: 'vault.unlock',
      details: { method: 'password' },
    })
  })

  it('forgets the Touch ID key so the next unlock requires the master password', async () => {
    const h = makeHarness({ isMac: true })
    await h.auth.setup('master password')

    expect(h.auth.forgetTouchID()).toEqual({ success: true })
    expect(h.keychainRemoves).toBe(1)
  })

  it('changes the master password after verifying the current password', async () => {
    const h = makeHarness()
    await h.auth.setup('old password')

    await expect(h.auth.changePassword({ current: 'old password', next: 'short' })).resolves.toEqual({
      success: false,
      error: 'new password must be at least 12 characters',
    })

    await expect(h.auth.changePassword({ current: 'wrong', next: 'new password' })).resolves.toEqual({
      success: false,
      wrongPassword: true,
      error: 'Current password is incorrect',
    })

    await expect(h.auth.changePassword({ current: 'old password', next: 'new password' })).resolves.toEqual({
      success: true,
      touchIdRestored: true,
    })

    h.vaultKey = null
    await expect(h.auth.unlockWithPassword('old password')).resolves.toEqual({
      success: false,
      wrongPassword: true,
      error: 'Incorrect master password',
    })

    const unlock = await h.auth.unlockWithPassword('new password')
    if (!unlock.success) throw new Error(unlock.error)
    expectBufferEquals(h.vaultKey, VAULT_KEY)
  })

  it('verifies the master password against the currently unlocked vault key', async () => {
    const h = makeHarness()
    await h.auth.setup('correct horse battery staple')

    await expect(h.auth.verifyMasterPassword('wrong password')).resolves.toEqual({
      success: false,
      wrongPassword: true,
      error: 'Incorrect master password',
    })
    await expect(h.auth.verifyMasterPassword('correct horse battery staple')).resolves.toEqual({
      success: true,
    })
  })

  it('uses stored scrypt work factors and migrates old password wraps on unlock', async () => {
    const h = makeHarness()
    const password = 'correct horse battery staple'
    await h.auth.setup(password)

    const oldParams = { N: 65536, r: 8, p: 1, keylen: 32 }
    h.params = JSON.stringify({
      version: 2,
      scrypt: { ...oldParams, salt: SALT.toString('hex') },
    })
    h.wrappedKey = fakeCrypto.seal(VAULT_KEY, await fakeCrypto.scrypt(password, SALT, oldParams))
    h.vaultKey = null

    const unlock = await h.auth.unlockWithPassword(password)
    if (!unlock.success) throw new Error(unlock.error)

    expectBufferEquals(h.vaultKey, VAULT_KEY)
    expect(JSON.parse(h.params!).scrypt).toMatchObject(currentScryptParams())

    h.vaultKey = null
    const unlockAfterMigration = await h.auth.unlockWithPassword(password)
    if (!unlockAfterMigration.success) throw new Error(unlockAfterMigration.error)
    expectBufferEquals(h.vaultKey, VAULT_KEY)
  })

  it('uses Keychain for Touch ID unlock and confirmation without exposing auth logic in index', async () => {
    const h = makeHarness({ isMac: true })
    await h.auth.setup('master password')
    h.vaultKey = null
    h.keychainResult = keychainResult(VAULT_KEY.toString('hex'))

    const unlock = await h.auth.unlockWithTouchID()
    if (!unlock.success) throw new Error(unlock.error)
    expect(unlock.data).toEqual(h.vaultData)
    expectBufferEquals(h.vaultKey, VAULT_KEY)

    h.keychainResult = keychainResult(VAULT_KEY.toString('hex'))
    expect(h.auth.confirmUnlockedKeychain('Approve agent request')).toEqual({ success: true })

    h.keychainResult = keychainResult(Buffer.from('different-key').toString('hex'))
    expect(h.auth.confirmUnlockedKeychain('Approve agent request')).toEqual({
      success: false,
      error: 'Confirmed key does not match the open vault',
    })
  })

  it('falls back to master-password recovery when the Touch ID key is stale', async () => {
    const h = makeHarness({ isMac: true })
    await h.auth.setup('master password')
    h.vaultKey = null
    h.keychainResult = keychainResult(Buffer.from('stale-vault-key').toString('hex'))

    await expect(h.auth.unlockWithTouchID()).resolves.toEqual({
      success: false,
      touchIdInvalid: true,
      error: 'Touch ID key no longer opens this vault — use your master password',
    })
    expect(h.keychainRemoves).toBe(0)
  })

  it('requires typed plaintext export confirmation when Touch ID is unavailable', () => {
    const h = makeHarness({ isMac: false })

    expect(h.auth.confirmPlaintextExport('Confirm plaintext export', 'nope')).toEqual({
      success: false,
      error: 'Typed plaintext export confirmation required',
    })
    expect(h.auth.confirmPlaintextExport('Confirm plaintext export', 'EXPORT PLAINTEXT')).toEqual({
      success: true,
    })
  })

  it('requires typed agent approval confirmation when Touch ID is unavailable', () => {
    const h = makeHarness({ isMac: false })

    expect(h.auth.confirmAgentApproval('Approve agent request', 'nope')).toEqual({
      success: false,
      error: 'Type APPROVE AGENT to approve agent secrets',
    })
    expect(h.auth.confirmAgentApproval('Approve agent request', 'APPROVE AGENT')).toEqual({
      success: true,
    })
  })

  it('requires typed reveal confirmation when Touch ID is unavailable', () => {
    const h = makeHarness({ isMac: false })

    expect(h.auth.confirmSecretReveal('Reveal secret', 'nope')).toEqual({
      success: false,
      error: 'Type REVEAL SECRET to reveal saved secret values',
    })
    expect(h.auth.confirmSecretReveal('Reveal secret', 'REVEAL SECRET')).toEqual({
      success: true,
    })
  })
})

const VAULT_KEY = Buffer.from('vaultage-test-vault-key')
const SALT = Buffer.from('auth-test-salt')

function makeHarness(opts: { isMac?: boolean } = {}) {
  let params: string | null = null
  let wrappedKey: Buffer | null = null
  let vaultData: unknown = null
  let vaultKey: Buffer | null = null
  let keychainResultValue = keychainResult(null, { notFound: true })
  const keychainStores: string[] = []
  let keychainRemoves = 0
  const auditEvents: { type: AuditEventType; details?: Record<string, unknown> }[] = []

  const storage: AuthStorage = {
    accessParams: async () => {
      if (!params) throw new Error('ENOENT')
    },
    ensureVaultDir: async () => undefined,
    readParams: async () => {
      if (!params) throw new Error('Missing params')
      return params
    },
    writeParams: async (raw) => {
      params = raw
    },
    readWrappedKey: async () => {
      if (!wrappedKey) throw new Error('Missing wrapped key')
      return wrappedKey
    },
    writeWrappedKey: async (raw) => {
      wrappedKey = raw
    },
    readVault: async (key) => {
      if (!vaultData) throw new Error('Missing vault')
      if (!key.equals(VAULT_KEY)) throw new Error('Wrong vault key')
      return vaultData
    },
    writeVault: async (json) => {
      vaultData = JSON.parse(json)
    },
  }

  const auth = new AuthController({
    storage,
    keychain: {
      isMac: Boolean(opts.isMac),
      retrieve: () => keychainResultValue,
      store: (hexKey) => {
        keychainStores.push(hexKey)
        return true
      },
      remove: () => {
        keychainRemoves += 1
        return true
      },
    },
    getVaultKey: () => vaultKey,
    setVaultKey: (next) => { vaultKey = next },
    recordAudit: (type, details) => auditEvents.push({ type, details }),
    randomId: () => 'root-id',
    crypto: fakeCrypto,
  })

  return {
    auth,
    auditEvents,
    keychainStores,
    get keychainRemoves() { return keychainRemoves },
    get vaultData() { return vaultData },
    get vaultKey() { return vaultKey },
    set vaultKey(next: Buffer | null) { vaultKey = next },
    get params() { return params },
    set params(next: string | null) { params = next },
    get wrappedKey() { return wrappedKey },
    set wrappedKey(next: Buffer | null) { wrappedKey = next },
    set keychainResult(next: KeychainResult) { keychainResultValue = next },
  }
}

const fakeCrypto: AuthCrypto = {
  randomVaultKey: () => Buffer.from(VAULT_KEY),
  randomSalt: () => Buffer.from(SALT),
  scrypt: async (password, salt, params = currentScryptParams()) =>
    Buffer.from(`wrapping:${password}:${salt.toString('hex')}:${scryptKey(params)}`),
  seal: (plain, key) => Buffer.concat([Buffer.from(`${key.toString('hex')}:`), plain]),
  open: (blob, key) => {
    const prefix = Buffer.from(`${key.toString('hex')}:`)
    if (blob.subarray(0, prefix.length).compare(prefix) !== 0) {
      throw new Error('Wrong key')
    }
    return Buffer.from(blob.subarray(prefix.length))
  },
  sameKey: (a, b) => a.equals(b),
}

function scryptKey(params: ScryptParams): string {
  return `${params.N}:${params.r}:${params.p}:${params.keylen ?? 32}`
}

function keychainResult(
  key: string | null,
  flags: Partial<Omit<KeychainResult, 'key'>> = {},
): KeychainResult {
  return {
    key,
    cancelled: false,
    authFailed: false,
    notFound: false,
    ...flags,
  }
}

function expectBufferEquals(actual: Buffer | null, expected: Buffer): void {
  expect(actual).not.toBeNull()
  expect(actual?.equals(expected)).toBe(true)
}
