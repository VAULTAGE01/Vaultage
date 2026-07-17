import { describe, expect, it } from 'vitest'
import type { AuditEventType } from './audit'
import { AuthController, type AuthCrypto, type AuthStorage } from './auth'
import type { KeychainResult } from './keychain'
import { currentScryptParams, type ScryptParams } from './vaultCrypto'
import { VaultSessionKeyring } from './vaultSessionKey'

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
      // Historical parameter files omitted keylen; AES-256 wrapping implies
      // 32 bytes and unlock should migrate the record after verification.
      scrypt: { N: oldParams.N, r: oldParams.r, p: oldParams.p, salt: SALT.toString('hex') },
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

  it('rejects untrusted scrypt parameters before attempting an expensive unlock', async () => {
    const h = makeHarness()
    await h.auth.setup('correct horse battery staple')
    h.params = JSON.stringify({
      version: 2,
      scrypt: {
        N: currentScryptParams().N * 8,
        r: currentScryptParams().r,
        p: currentScryptParams().p,
        keylen: currentScryptParams().keylen,
        salt: SALT.toString('hex'),
      },
    })
    h.vaultKey = null

    await expect(h.auth.unlockWithPassword('correct horse battery staple')).resolves.toEqual({
      success: false,
      error: 'Invalid scrypt N',
    })
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

  it('clears stale Touch ID keys before falling back to master-password recovery', async () => {
    const h = makeHarness({ isMac: true })
    await h.auth.setup('master password')
    h.vaultKey = null
    h.keychainResult = keychainResult(Buffer.from('stale-vault-key').toString('hex'))

    await expect(h.auth.unlockWithTouchID()).resolves.toEqual({
      success: false,
      touchIdInvalid: true,
      error: 'Touch ID key no longer opens this vault — use your master password',
    })
    expect(h.keychainRemoves).toBe(1)
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

  it('fails closed for project .env export when macOS user presence is unavailable', () => {
    const h = makeHarness({ isMac: false })
    expect(h.auth.confirmProjectEnvExport('Approve project export')).toEqual({
      success: false,
      error: 'Project .env export requires macOS user presence',
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

  it('refuses to run setup over a complete or partial vault state', async () => {
    const h = makeHarness()
    await expect(h.auth.setup('first master password')).resolves.toMatchObject({ success: true })
    const originalParams = h.params

    await expect(h.auth.setup('replacement password')).resolves.toMatchObject({
      success: false,
      alreadySetup: true,
    })
    expect(h.params).toBe(originalParams)

    h.params = null
    await expect(h.auth.status()).resolves.toMatchObject({
      needsSetup: false,
      incomplete: true,
    })
    await expect(h.auth.setup('replacement password')).resolves.toMatchObject({
      success: false,
      alreadySetup: true,
      incomplete: true,
    })
  })

  it('cancels an async password unlock when lock invalidates its session epoch', async () => {
    const readEntered = deferred<void>()
    const continueRead = deferred<void>()
    let delayRead = false
    const h = makeHarness({
      beforeReadVault: async () => {
        if (!delayRead) return
        readEntered.resolve()
        await continueRead.promise
      },
    })
    await h.auth.setup('correct horse battery staple')
    await h.lock()
    delayRead = true

    const unlock = h.auth.unlockWithPassword('correct horse battery staple')
    await readEntered.promise
    const locking = h.lock()
    continueRead.resolve()

    await expect(unlock).resolves.toMatchObject({ success: false, sessionChanged: true })
    await locking
    expect(h.vaultKey).toBeNull()
    expect(h.keychainStores).toHaveLength(1)
  })

  it('keeps the old credentials active when a password transaction fails', async () => {
    let failCommit = false
    const h = makeHarness({
      commitAuthCredentials: async () => {
        if (failCommit) throw new Error('injected credential commit failure')
      },
    })
    await h.auth.setup('old master password')
    failCommit = true

    await expect(h.auth.changePassword({
      current: 'old master password',
      next: 'new master password',
    })).resolves.toEqual({
      success: false,
      error: 'injected credential commit failure',
    })

    await h.lock()
    failCommit = false
    await expect(h.auth.unlockWithPassword('old master password')).resolves.toMatchObject({ success: true })
    await h.lock()
    await expect(h.auth.unlockWithPassword('new master password')).resolves.toMatchObject({
      success: false,
      wrongPassword: true,
    })
  })

  it('aborts a password commit that is waiting when the vault locks', async () => {
    const commitEntered = deferred<void>()
    const continueCommit = deferred<void>()
    let delayCommit = false
    const h = makeHarness({
      commitAuthCredentials: async (_paramsRaw, _wrapped, assertCurrent) => {
        if (!delayCommit) return
        commitEntered.resolve()
        await continueCommit.promise
        assertCurrent()
      },
    })
    await h.auth.setup('old master password')
    delayCommit = true

    const change = h.auth.changePassword({
      current: 'old master password',
      next: 'new master password',
    })
    await commitEntered.promise
    const locking = h.lock()
    continueCommit.resolve()

    await expect(change).resolves.toMatchObject({ success: false, sessionChanged: true })
    await locking
    await expect(h.auth.unlockWithPassword('old master password')).resolves.toMatchObject({ success: true })
  })

  it('restores only a validated snapshot of the currently authenticated vault', async () => {
    const h = makeHarness()
    await h.auth.setup('current master password')
    const backupPassword = 'backup master password'
    const backupParams = currentScryptParams()
    const backupWrappingKey = await fakeCrypto.scrypt(backupPassword, SALT, backupParams)
    const snapshot = {
      paramsRaw: JSON.stringify({
        version: 2,
        scrypt: { ...backupParams, salt: SALT.toString('hex') },
      }),
      wrappedKey: fakeCrypto.seal(VAULT_KEY, backupWrappingKey),
      vaultBlob: fakeCrypto.seal(
        Buffer.from(JSON.stringify(restoredBackupVault())),
        VAULT_KEY,
      ),
    }

    await expect(h.auth.restoreBackup(snapshot, {
      currentPassword: 'current master password',
      backupPassword,
    })).resolves.toEqual({ success: true })
    expect(h.vaultData).toEqual(restoredBackupVault())

    await h.lock()
    await expect(h.auth.restoreBackup(snapshot, {
      currentPassword: 'backup master password',
      backupPassword,
    })).resolves.toEqual({ success: true })

    const foreignKey = Buffer.from('different-vault-key-material')
    const foreign = {
      ...snapshot,
      wrappedKey: fakeCrypto.seal(foreignKey, backupWrappingKey),
      vaultBlob: fakeCrypto.seal(Buffer.from(JSON.stringify(restoredBackupVault())), foreignKey),
    }
    await expect(h.auth.restoreBackup(foreign, {
      currentPassword: backupPassword,
      backupPassword,
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('different vault'),
    })
  })
})

const VAULT_KEY = Buffer.from('vaultage-test-vault-key')
const SALT = Buffer.from('auth-test-salt')

function restoredBackupVault() {
  return {
    version: 2,
    marker: 'restored-backup',
    root: { id: 'root', name: 'Vault', children: [], secrets: [], itemOrder: [] },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function makeHarness(opts: {
  isMac?: boolean
  beforeReadVault?: () => Promise<void>
  commitAuthCredentials?: AuthStorage['commitAuthCredentials']
} = {}) {
  let params: string | null = null
  let wrappedKey: Buffer | null = null
  let vaultData: unknown = null
  let keychainResultValue = keychainResult(null, { notFound: true })
  const keychainStores: string[] = []
  let keychainRemoves = 0
  const auditEvents: { type: AuditEventType; details?: Record<string, unknown> }[] = []
  const session = new VaultSessionKeyring()

  const storage: AuthStorage = {
    ensureVaultDir: async () => undefined,
    getAuthStateStatus: async () => {
      const count = [params, wrappedKey, vaultData].filter(Boolean).length
      if (count === 0) return 'missing'
      return count === 3 ? 'ready' : 'incomplete'
    },
    readCredentials: async () => {
      if (!params || !wrappedKey) throw new Error('Missing credentials')
      return { paramsRaw: params, wrappedKey: Buffer.from(wrappedKey) }
    },
    readRecoveryCredentials: async () => {
      if (!params || !wrappedKey) throw new Error('Missing recovery credentials')
      return { paramsRaw: params, wrappedKey: Buffer.from(wrappedKey) }
    },
    readVault: async (key) => {
      await opts.beforeReadVault?.()
      if (!vaultData) throw new Error('Missing vault')
      if (!key.equals(VAULT_KEY)) throw new Error('Wrong vault key')
      return vaultData
    },
    createVaultState: async (input, assertCurrent) => {
      if (params || wrappedKey || vaultData) throw new Error('Vault is already initialized; setup cannot replace it')
      assertCurrent()
      params = input.paramsRaw
      wrappedKey = Buffer.from(input.wrappedKey)
      vaultData = JSON.parse(input.vaultJson)
    },
    commitAuthCredentials: async (paramsRaw, wrapped, assertCurrent) => {
      await opts.commitAuthCredentials?.(paramsRaw, wrapped, assertCurrent)
      assertCurrent()
      params = paramsRaw
      wrappedKey = Buffer.from(wrapped)
    },
    commitRestoredVaultState: async (snapshot, vaultKey, assertCurrent) => {
      assertCurrent()
      params = snapshot.paramsRaw
      wrappedKey = Buffer.from(snapshot.wrappedKey)
      vaultData = JSON.parse(fakeCrypto.open(snapshot.vaultBlob, vaultKey).toString('utf8'))
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
    session,
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
    get vaultKey() { return session.currentKey() },
    set vaultKey(next: Buffer | null) {
      if (next) session.installKey(next, session.epoch)
      else void session.invalidate()
    },
    get params() { return params },
    set params(next: string | null) { params = next },
    get wrappedKey() { return wrappedKey },
    set wrappedKey(next: Buffer | null) { wrappedKey = next },
    set keychainResult(next: KeychainResult) { keychainResultValue = next },
    lock: () => session.invalidate(),
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
