import type { AuditEventType } from './audit'
import type { KeychainResult } from './keychain'
import type { AuthStateStatus, VaultBackupSnapshot } from './vaultStorage'
import type { VaultKeyLease, VaultSessionOperation } from './vaultSessionKey'
import { VaultSessionChangedError } from './vaultSessionKey'
import {
  currentScryptParams,
  KEY_LENGTH,
  open,
  randomSalt,
  randomVaultKey,
  sameKey,
  SCRYPT_MAXMEM,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  scrypt,
  seal,
  type ScryptParams,
} from './vaultCrypto'
import {
  AGENT_APPROVAL_CONFIRM_PHRASE,
  SECRET_REVEAL_CONFIRM_PHRASE,
  validateAgentApprovalConfirmation,
  validateMasterPasswordInput,
  validatePasswordInput,
  validatePlaintextExportConfirmation,
  validateSecretRevealConfirmation,
} from './security'
import { DEFAULT_LOCAL_FOLDERS } from '../shared/defaultLocalFolders'
import { VaultValidationError, validateVaultRoot } from '../shared/vaultValidation'

export interface AuthStorage {
  ensureVaultDir(): Promise<void>
  getAuthStateStatus(): Promise<AuthStateStatus>
  readCredentials(): Promise<{ paramsRaw: string; wrappedKey: Buffer }>
  readRecoveryCredentials?(): Promise<{ paramsRaw: string; wrappedKey: Buffer }>
  readVault(key: Buffer): Promise<unknown>
  createVaultState(
    input: { paramsRaw: string; wrappedKey: Buffer; vaultJson: string; vaultKey: Buffer },
    assertCurrent: () => void,
  ): Promise<void>
  commitAuthCredentials(paramsRaw: string, wrappedKey: Buffer, assertCurrent: () => void): Promise<void>
  commitRestoredVaultState(
    snapshot: VaultBackupSnapshot,
    vaultKey: Buffer,
    assertCurrent: () => void,
  ): Promise<void>
}

export interface AuthKeychain {
  isMac: boolean
  store(hexKey: string): boolean
  retrieve(prompt?: string): KeychainResult
  remove(): boolean
}

export interface AuthCrypto {
  randomVaultKey(): Buffer
  randomSalt(): Buffer
  scrypt(password: string, salt: Buffer, params?: ScryptParams): Promise<Buffer>
  seal(plain: Buffer, key: Buffer): Buffer
  open(blob: Buffer, key: Buffer): Buffer
  sameKey(a: Buffer, b: Buffer): boolean
}

export interface AuthSession {
  beginOperation(): VaultSessionOperation | null
  leaseCurrentKey(): VaultKeyLease | null
  installKey(key: Buffer, expectedEpoch: number): boolean
}

export interface AuthControllerDeps {
  storage: AuthStorage
  keychain: AuthKeychain
  session: AuthSession
  normalizeVaultData?: (vault: unknown) => unknown
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  randomId: () => string
  crypto?: AuthCrypto
}

type AuthResult<T = unknown> =
  | { success: true; data?: T; touchIdRestored?: boolean }
  | {
      success: false
      error: string
      cancelled?: boolean
      notFound?: boolean
      authFailed?: boolean
      touchIdInvalid?: boolean
      wrongPassword?: boolean
      alreadySetup?: boolean
      incomplete?: boolean
      sessionChanged?: boolean
    }

export class AuthController {
  private readonly crypto: AuthCrypto

  constructor(private readonly deps: AuthControllerDeps) {
    this.crypto = deps.crypto ?? {
      randomVaultKey,
      randomSalt,
      scrypt,
      seal,
      open,
      sameKey,
    }
  }

  async status(): Promise<{
    needsSetup: boolean
    incomplete?: boolean
    error?: string
  }> {
    const status = await this.deps.storage.getAuthStateStatus()
    if (status === 'missing') return { needsSetup: true }
    if (status === 'ready') return { needsSetup: false }
    return {
      needsSetup: false,
      incomplete: true,
      error: 'Vault authentication files are incomplete. Restore a validated backup instead of running setup.',
    }
  }

  async setup(password: unknown): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()

    let newVaultKey: Buffer | null = null
    let wrappingKey: Buffer | null = null
    try {
      const masterPassword = validateMasterPasswordInput(password, 'master password')
      await this.deps.storage.ensureVaultDir()
      operation.assertCurrent()

      const state = await this.deps.storage.getAuthStateStatus()
      if (state !== 'missing') {
        return {
          success: false,
          alreadySetup: true,
          incomplete: state === 'incomplete' || undefined,
          error: state === 'incomplete'
            ? 'Vault authentication files are incomplete. Setup will not overwrite them; restore a validated backup.'
            : 'Vault is already initialized; setup cannot replace it',
        }
      }

      newVaultKey = this.crypto.randomVaultKey()
      const salt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      wrappingKey = await this.crypto.scrypt(masterPassword, salt, scryptParams)
      operation.assertCurrent()
      const wrapped = this.crypto.seal(newVaultKey, wrappingKey)
      const paramsRaw = serializeParams(scryptParams, salt)

      const rootId = this.deps.randomId()
      const defaultFolders = DEFAULT_LOCAL_FOLDERS.map(folder => ({
        id: `${rootId}-${folder.slug}`,
        name: folder.name,
        children: [],
        secrets: [],
        itemOrder: [],
      }))
      const emptyVault = this.normalizeVaultData({
        version: 2,
        root: {
          id: rootId,
          name: 'My Vault',
          children: defaultFolders,
          secrets: [],
          itemOrder: defaultFolders.map(folder => ({ kind: 'folder', id: folder.id })),
        },
        preferences: { localDefaultFoldersCreated: true },
      })

      await this.deps.storage.createVaultState({
        paramsRaw,
        wrappedKey: wrapped,
        vaultJson: JSON.stringify(emptyVault),
        vaultKey: newVaultKey,
      }, operation.assertCurrent)
      operation.assertCurrent()

      if (!this.deps.session.installKey(newVaultKey, operation.epoch)) {
        return sessionChangedResult()
      }
      const touchIdRestored = this.deps.keychain.store(newVaultKey.toString('hex'))
      this.deps.recordAudit('vault.setup', { method: 'password' })
      return { success: true, data: emptyVault, touchIdRestored }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      const message = errorMessage(err)
      if (/already initialized|cannot replace/i.test(message)) {
        return { success: false, alreadySetup: true, error: message }
      }
      return { success: false, error: message }
    } finally {
      wrappingKey?.fill(0)
      newVaultKey?.fill(0)
      operation.release()
    }
  }

  async unlockWithTouchID(): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()

    let vaultKey: Buffer | null = null
    try {
      const { key, cancelled, notFound, authFailed } = this.deps.keychain.retrieve()
      if (cancelled) return { success: false, cancelled: true, error: 'Touch ID cancelled' }
      if (authFailed) return { success: false, authFailed: true, error: 'Touch ID failed — use your master password' }
      if (notFound || !key) return { success: false, notFound: true, error: 'Key not in Keychain — use your master password' }

      vaultKey = Buffer.from(key, 'hex')
      const rawData = await this.deps.storage.readVault(vaultKey)
      operation.assertCurrent()
      const data = this.normalizeVaultData(rawData)
      if (!this.deps.session.installKey(vaultKey, operation.epoch)) return sessionChangedResult()
      this.deps.recordAudit('vault.unlock', { method: 'touchid' })
      return { success: true, data }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      if (err instanceof VaultValidationError) {
        console.warn(`[vault-auth] Vault validation failed at ${err.path} (${err.code})`)
        return {
          success: false,
          error: 'Vault data failed integrity validation. Restore a known-good backup before continuing.',
        }
      }
      this.deps.keychain.remove()
      return {
        success: false,
        touchIdInvalid: true,
        error: 'Touch ID key no longer opens this vault — use your master password',
      }
    } finally {
      vaultKey?.fill(0)
      operation.release()
    }
  }

  async unlockWithPassword(password: unknown): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()

    let wrappingKey: Buffer | null = null
    let unwrapped: Buffer | null = null
    try {
      const masterPassword = validatePasswordInput(password)
      const credentials = await this.deps.storage.readCredentials()
      const sp = storedScryptParams(JSON.parse(credentials.paramsRaw).scrypt)
      const salt = Buffer.from(sp.salt, 'hex')

      wrappingKey = await this.crypto.scrypt(masterPassword, salt, sp)
      operation.assertCurrent()
      try {
        unwrapped = this.crypto.open(credentials.wrappedKey, wrappingKey)
      } catch {
        return { success: false, wrongPassword: true, error: 'Incorrect master password' }
      }

      const rawData = await this.deps.storage.readVault(unwrapped)
      operation.assertCurrent()
      if (!usesCurrentScryptParams(sp)) {
        await this.rewrapVaultKey(masterPassword, unwrapped, operation.assertCurrent)
      }
      operation.assertCurrent()
      const data = this.normalizeVaultData(rawData)
      if (!this.deps.session.installKey(unwrapped, operation.epoch)) return sessionChangedResult()

      const touchIdRestored = this.deps.keychain.store(unwrapped.toString('hex'))
      this.deps.recordAudit('vault.unlock', { method: 'password' })
      return { success: true, data, touchIdRestored }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      if (err instanceof VaultValidationError) {
        console.warn(`[vault-auth] Vault validation failed at ${err.path} (${err.code})`)
        return {
          success: false,
          error: 'Vault data failed integrity validation. Restore a known-good backup before continuing.',
        }
      }
      return { success: false, error: errorMessage(err) }
    } finally {
      wrappingKey?.fill(0)
      unwrapped?.fill(0)
      operation.release()
    }
  }

  async changePassword(payload?: { current?: unknown; next?: unknown }): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) {
      operation.release()
      return { success: false, error: 'Not authenticated' }
    }

    let oldWrappingKey: Buffer | null = null
    let confirmedKey: Buffer | null = null
    let newWrappingKey: Buffer | null = null
    try {
      const current = validatePasswordInput(payload?.current, 'current password')
      const next = validateMasterPasswordInput(payload?.next, 'new password')
      const credentials = await this.deps.storage.readCredentials()
      const sp = storedScryptParams(JSON.parse(credentials.paramsRaw).scrypt)
      const oldSalt = Buffer.from(sp.salt, 'hex')

      oldWrappingKey = await this.crypto.scrypt(current, oldSalt, sp)
      operation.assertCurrent()
      vaultKey.assertCurrent()
      try {
        confirmedKey = this.crypto.open(credentials.wrappedKey, oldWrappingKey)
        if (!this.crypto.sameKey(confirmedKey, vaultKey.key)) throw new Error('Mismatched vault key')
      } catch {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }

      const newSalt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      newWrappingKey = await this.crypto.scrypt(next, newSalt, scryptParams)
      operation.assertCurrent()
      vaultKey.assertCurrent()
      const newWrapped = this.crypto.seal(vaultKey.key, newWrappingKey)
      const assertCurrent = () => {
        operation.assertCurrent()
        vaultKey.assertCurrent()
      }
      await this.deps.storage.commitAuthCredentials(
        serializeParams(scryptParams, newSalt),
        newWrapped,
        assertCurrent,
      )

      let touchIdRestored = false
      try {
        assertCurrent()
        touchIdRestored = this.deps.keychain.store(vaultKey.key.toString('hex'))
      } catch (err) {
        if (!(err instanceof VaultSessionChangedError)) throw err
        // The password transaction committed before a simultaneous lock. Do
        // not repopulate Keychain after lock, but report the committed change.
      }
      return { success: true, touchIdRestored }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      oldWrappingKey?.fill(0)
      confirmedKey?.fill(0)
      newWrappingKey?.fill(0)
      vaultKey.release()
      operation.release()
    }
  }

  async verifyMasterPassword(password: unknown): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) {
      operation.release()
      return { success: false, error: 'Not authenticated' }
    }

    let wrappingKey: Buffer | null = null
    let unwrapped: Buffer | null = null
    try {
      const masterPassword = validatePasswordInput(password, 'master password')
      const credentials = await this.deps.storage.readCredentials()
      const sp = storedScryptParams(JSON.parse(credentials.paramsRaw).scrypt)
      wrappingKey = await this.crypto.scrypt(masterPassword, Buffer.from(sp.salt, 'hex'), sp)
      operation.assertCurrent()
      vaultKey.assertCurrent()
      unwrapped = this.crypto.open(credentials.wrappedKey, wrappingKey)
      if (!this.crypto.sameKey(unwrapped, vaultKey.key)) {
        return { success: false, wrongPassword: true, error: 'Incorrect master password' }
      }
      return { success: true }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, wrongPassword: true, error: 'Incorrect master password' }
    } finally {
      wrappingKey?.fill(0)
      unwrapped?.fill(0)
      vaultKey.release()
      operation.release()
    }
  }

  async restoreBackup(
    snapshot: VaultBackupSnapshot,
    payload?: { currentPassword?: unknown; backupPassword?: unknown },
  ): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const currentVaultKey = this.deps.session.leaseCurrentKey()

    let currentWrappingKey: Buffer | null = null
    let confirmedCurrentKey: Buffer | null = null
    let backupWrappingKey: Buffer | null = null
    let restoredVaultKey: Buffer | null = null
    try {
      const currentPassword = validatePasswordInput(payload?.currentPassword, 'current password')
      const backupPassword = validatePasswordInput(payload?.backupPassword, 'backup password')

      let currentCredentials: { paramsRaw: string; wrappedKey: Buffer }
      try {
        currentCredentials = await this.deps.storage.readCredentials()
      } catch (err) {
        if (!this.deps.storage.readRecoveryCredentials) throw err
        currentCredentials = await this.deps.storage.readRecoveryCredentials()
      }
      const currentSp = storedScryptParams(JSON.parse(currentCredentials.paramsRaw).scrypt)
      currentWrappingKey = await this.crypto.scrypt(
        currentPassword,
        Buffer.from(currentSp.salt, 'hex'),
        currentSp,
      )
      confirmedCurrentKey = this.crypto.open(currentCredentials.wrappedKey, currentWrappingKey)
      if (currentVaultKey && !this.crypto.sameKey(confirmedCurrentKey, currentVaultKey.key)) {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }

      const backupSp = storedScryptParams(JSON.parse(snapshot.paramsRaw).scrypt)
      backupWrappingKey = await this.crypto.scrypt(
        backupPassword,
        Buffer.from(backupSp.salt, 'hex'),
        backupSp,
      )
      let restoredVaultPlaintext: Buffer | null = null
      try {
        restoredVaultKey = this.crypto.open(snapshot.wrappedKey, backupWrappingKey)
        restoredVaultPlaintext = this.crypto.open(snapshot.vaultBlob, restoredVaultKey)
        const restoredVault: unknown = JSON.parse(restoredVaultPlaintext.toString('utf8'))
        validateVaultRoot(restoredVault, { boundary: 'persisted' })
      } catch {
        return { success: false, wrongPassword: true, error: 'Backup password is incorrect or the backup is damaged' }
      } finally {
        restoredVaultPlaintext?.fill(0)
      }
      if (!this.crypto.sameKey(restoredVaultKey, confirmedCurrentKey)) {
        return {
          success: false,
          error: 'This backup belongs to a different vault. Cross-vault replacement is not allowed while a vault exists.',
        }
      }

      const assertCurrent = () => {
        operation.assertCurrent()
        currentVaultKey?.assertCurrent()
      }
      await this.deps.storage.commitRestoredVaultState(snapshot, restoredVaultKey, assertCurrent)
      this.deps.keychain.remove()
      return { success: true }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      currentWrappingKey?.fill(0)
      confirmedCurrentKey?.fill(0)
      backupWrappingKey?.fill(0)
      restoredVaultKey?.fill(0)
      currentVaultKey?.release()
      operation.release()
    }
  }

  forgetTouchID(): AuthResult {
    if (!this.deps.keychain.isMac) {
      return { success: false, notFound: true, error: 'Touch ID unavailable' }
    }
    if (!this.deps.keychain.remove()) {
      return { success: false, error: 'Could not remove Touch ID key from Keychain' }
    }
    return { success: true }
  }

  confirmUnlockedKeychain(prompt: string): AuthResult {
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      if (!this.deps.keychain.isMac) return { success: false, notFound: true, error: 'Touch ID unavailable' }

      const result = this.deps.keychain.retrieve(prompt)
      if (result.cancelled) return { success: false, cancelled: true, error: 'Touch ID cancelled' }
      if (result.authFailed) return { success: false, authFailed: true, error: 'Touch ID failed' }
      if (result.notFound || !result.key) return { success: false, notFound: true, error: 'Key not in Keychain' }

      let confirmed: Buffer
      try {
        confirmed = Buffer.from(result.key, 'hex')
      } catch {
        return { success: false, error: 'Keychain returned invalid key material' }
      }

      try {
        vaultKey.assertCurrent()
        if (!this.crypto.sameKey(confirmed, vaultKey.key)) {
          return { success: false, error: 'Confirmed key does not match the open vault' }
        }
        return { success: true }
      } finally {
        confirmed.fill(0)
      }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      vaultKey.release()
    }
  }

  confirmPlaintextExport(prompt: string, phrase?: string): AuthResult {
    if (this.deps.keychain.isMac) return this.confirmUnlockedKeychain(prompt)
    if (validatePlaintextExportConfirmation(phrase)) return { success: true }
    return { success: false, error: 'Typed plaintext export confirmation required' }
  }

  confirmProjectEnvExport(prompt: string): AuthResult {
    if (!this.deps.keychain.isMac) {
      return { success: false, error: 'Project .env export requires macOS user presence' }
    }
    return this.confirmUnlockedKeychain(prompt)
  }

  confirmAgentApproval(prompt: string, phrase?: string): AuthResult {
    if (this.deps.keychain.isMac) return this.confirmUnlockedKeychain(prompt)
    if (validateAgentApprovalConfirmation(phrase)) return { success: true }
    return {
      success: false,
      error: `Type ${AGENT_APPROVAL_CONFIRM_PHRASE} to approve agent secrets`,
    }
  }

  confirmSecretReveal(prompt: string, phrase?: string): AuthResult {
    if (this.deps.keychain.isMac) return this.confirmUnlockedKeychain(prompt)
    if (validateSecretRevealConfirmation(phrase)) return { success: true }
    return {
      success: false,
      error: `Type ${SECRET_REVEAL_CONFIRM_PHRASE} to reveal saved secret values`,
    }
  }

  private normalizeVaultData(vault: unknown): unknown {
    return this.deps.normalizeVaultData ? this.deps.normalizeVaultData(vault) : vault
  }

  private async rewrapVaultKey(
    masterPassword: string,
    vaultKey: Buffer,
    assertCurrent: () => void,
  ): Promise<void> {
    let wrappingKey: Buffer | null = null
    try {
      const salt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      wrappingKey = await this.crypto.scrypt(masterPassword, salt, scryptParams)
      assertCurrent()
      const wrapped = this.crypto.seal(vaultKey, wrappingKey)
      await this.deps.storage.commitAuthCredentials(
        serializeParams(scryptParams, salt),
        wrapped,
        assertCurrent,
      )
    } finally {
      wrappingKey?.fill(0)
    }
  }
}

function sessionChangedResult(): AuthResult {
  return {
    success: false,
    sessionChanged: true,
    error: 'Vault session changed; unlock and try again',
  }
}

function serializeParams(params: ScryptParams, salt: Buffer): string {
  return JSON.stringify({
    version: 2,
    scrypt: { ...params, salt: salt.toString('hex') },
  })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface StoredScryptParams extends Required<ScryptParams> {
  salt: string
}

function storedScryptParams(input: unknown): StoredScryptParams {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid scrypt parameters')
  }
  const params = input as Record<string, unknown>
  const N = boundedPositiveInteger(params.N, 'scrypt N', SCRYPT_N)
  const r = boundedPositiveInteger(params.r, 'scrypt r', SCRYPT_R)
  const p = boundedPositiveInteger(params.p, 'scrypt p', SCRYPT_P)
  if ((N & (N - 1)) !== 0) throw new Error('Invalid scrypt N')
  if (128 * N * r > SCRYPT_MAXMEM / 2) throw new Error('Invalid scrypt memory cost')
  const keylen = params.keylen === undefined
    ? KEY_LENGTH
    : boundedPositiveInteger(params.keylen, 'scrypt key length', KEY_LENGTH)
  if (keylen !== KEY_LENGTH) throw new Error('Invalid scrypt key length')
  const salt = requireHex(params.salt, 'scrypt salt')
  // Historical fixtures/installations may use salts shorter than the current
  // 32-byte generator. They remain safe to read and are rewrapped on unlock;
  // the upper bound prevents hostile metadata from causing oversized work.
  if (salt.length < 16 || salt.length > 128) throw new Error('Invalid scrypt salt')
  return {
    N,
    r,
    p,
    keylen,
    salt,
  }
}

function usesCurrentScryptParams(params: ScryptParams): boolean {
  const current = currentScryptParams()
  return params.N === current.N &&
    params.r === current.r &&
    params.p === current.p &&
    (params.keylen ?? current.keylen) === current.keylen
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function boundedPositiveInteger(value: unknown, label: string, maximum: number): number {
  const integer = positiveInteger(value, label)
  if (integer > maximum) throw new Error(`Invalid ${label}`)
  return integer
}

function requireHex(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}
