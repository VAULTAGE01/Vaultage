import type { AuditEventType } from './audit'
import type { KeychainResult } from './keychain'
import {
  currentScryptParams,
  open,
  randomSalt,
  randomVaultKey,
  sameKey,
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

export interface AuthStorage {
  accessParams(): Promise<void>
  ensureVaultDir(): Promise<void>
  readParams(): Promise<string>
  writeParams(raw: string): Promise<void>
  readWrappedKey(): Promise<Buffer>
  writeWrappedKey(raw: Buffer): Promise<void>
  readVault(key: Buffer): Promise<unknown>
  writeVault(json: string, key: Buffer): Promise<void>
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

export interface AuthControllerDeps {
  storage: AuthStorage
  keychain: AuthKeychain
  getVaultKey: () => Buffer | null
  setVaultKey: (key: Buffer) => void
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

  async status(): Promise<{ needsSetup: boolean }> {
    try {
      await this.deps.storage.accessParams()
      return { needsSetup: false }
    } catch {
      return { needsSetup: true }
    }
  }

  async setup(password: unknown): Promise<AuthResult> {
    try {
      const masterPassword = validateMasterPasswordInput(password, 'master password')
      await this.deps.storage.ensureVaultDir()

      const newVaultKey = this.crypto.randomVaultKey()
      const salt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      const wrappingKey = await this.crypto.scrypt(masterPassword, salt, scryptParams)
      const wrapped = this.crypto.seal(newVaultKey, wrappingKey)

      await this.deps.storage.writeParams(JSON.stringify({
        version: 2,
        scrypt: { ...scryptParams, salt: salt.toString('hex') },
      }))
      await this.deps.storage.writeWrappedKey(wrapped)

      const touchIdRestored = this.deps.keychain.store(newVaultKey.toString('hex'))
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
      await this.deps.storage.writeVault(JSON.stringify(emptyVault), newVaultKey)

      this.deps.setVaultKey(newVaultKey)
      this.deps.recordAudit('vault.setup', { method: 'password' })
      return { success: true, data: emptyVault, touchIdRestored }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  }

  async unlockWithTouchID(): Promise<AuthResult> {
    const { key, cancelled, notFound, authFailed } = this.deps.keychain.retrieve()

    if (cancelled) return { success: false, cancelled: true, error: 'Touch ID cancelled' }
    if (authFailed) return { success: false, authFailed: true, error: 'Touch ID failed — use your master password' }
    if (notFound || !key) return { success: false, notFound: true, error: 'Key not in Keychain — use your master password' }

    try {
      const vaultKey = Buffer.from(key, 'hex')
      const data = this.normalizeVaultData(await this.deps.storage.readVault(vaultKey))
      this.deps.setVaultKey(vaultKey)
      this.deps.recordAudit('vault.unlock', { method: 'touchid' })
      return { success: true, data }
    } catch {
      return {
        success: false,
        touchIdInvalid: true,
        error: 'Touch ID key no longer opens this vault — use your master password',
      }
    }
  }

  async unlockWithPassword(password: unknown): Promise<AuthResult> {
    try {
      const masterPassword = validatePasswordInput(password)
      const paramsRaw = await this.deps.storage.readParams()
      const params = JSON.parse(paramsRaw)
      const sp = storedScryptParams(params.scrypt)
      const salt = Buffer.from(sp.salt, 'hex')

      const wrappingKey = await this.crypto.scrypt(masterPassword, salt, sp)

      let unwrapped: Buffer
      try {
        const wrapped = await this.deps.storage.readWrappedKey()
        unwrapped = this.crypto.open(wrapped, wrappingKey)
      } catch {
        return { success: false, wrongPassword: true, error: 'Incorrect master password' }
      }

      const data = this.normalizeVaultData(await this.deps.storage.readVault(unwrapped))
      if (!usesCurrentScryptParams(sp)) {
        await this.rewrapVaultKey(masterPassword, unwrapped)
      }
      const touchIdRestored = this.deps.keychain.store(unwrapped.toString('hex'))
      this.deps.setVaultKey(unwrapped)
      this.deps.recordAudit('vault.unlock', { method: 'password' })
      return { success: true, data, touchIdRestored }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  }

  async changePassword(payload?: { current?: unknown; next?: unknown }): Promise<AuthResult> {
    const vaultKey = this.deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }

    try {
      const current = validatePasswordInput(payload?.current, 'current password')
      const next = validateMasterPasswordInput(payload?.next, 'new password')

      const paramsRaw = await this.deps.storage.readParams()
      const sp = storedScryptParams(JSON.parse(paramsRaw).scrypt)
      const oldSalt = Buffer.from(sp.salt, 'hex')

      const oldWrappingKey = await this.crypto.scrypt(current, oldSalt, sp)
      try {
        const wrapped = await this.deps.storage.readWrappedKey()
        this.crypto.open(wrapped, oldWrappingKey)
      } catch {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }

      const newSalt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      const newWrappingKey = await this.crypto.scrypt(next, newSalt, scryptParams)
      const newWrapped = this.crypto.seal(vaultKey, newWrappingKey)

      await this.deps.storage.writeParams(JSON.stringify({
        version: 2,
        scrypt: { ...scryptParams, salt: newSalt.toString('hex') },
      }))
      await this.deps.storage.writeWrappedKey(newWrapped)
      const touchIdRestored = this.deps.keychain.store(vaultKey.toString('hex'))
      return { success: true, touchIdRestored }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  }

  async verifyMasterPassword(password: unknown): Promise<AuthResult> {
    const vaultKey = this.deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }

    let unwrapped: Buffer | null = null
    try {
      const masterPassword = validatePasswordInput(password, 'master password')
      const paramsRaw = await this.deps.storage.readParams()
      const sp = storedScryptParams(JSON.parse(paramsRaw).scrypt)
      const salt = Buffer.from(sp.salt, 'hex')
      const wrappingKey = await this.crypto.scrypt(masterPassword, salt, sp)
      const wrapped = await this.deps.storage.readWrappedKey()
      unwrapped = this.crypto.open(wrapped, wrappingKey)
      if (!this.crypto.sameKey(unwrapped, vaultKey)) {
        return { success: false, wrongPassword: true, error: 'Incorrect master password' }
      }
      return { success: true }
    } catch {
      return { success: false, wrongPassword: true, error: 'Incorrect master password' }
    } finally {
      unwrapped?.fill(0)
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
    const vaultKey = this.deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
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
      if (!this.crypto.sameKey(confirmed, vaultKey)) {
        return { success: false, error: 'Confirmed key does not match the open vault' }
      }
      return { success: true }
    } finally {
      confirmed.fill(0)
    }
  }

  confirmPlaintextExport(prompt: string, phrase?: string): AuthResult {
    if (this.deps.keychain.isMac) return this.confirmUnlockedKeychain(prompt)
    if (validatePlaintextExportConfirmation(phrase)) return { success: true }
    return { success: false, error: 'Typed plaintext export confirmation required' }
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

  private async rewrapVaultKey(masterPassword: string, vaultKey: Buffer): Promise<void> {
    const salt = this.crypto.randomSalt()
    const scryptParams = currentScryptParams()
    const wrappingKey = await this.crypto.scrypt(masterPassword, salt, scryptParams)
    const wrapped = this.crypto.seal(vaultKey, wrappingKey)
    await this.deps.storage.writeParams(JSON.stringify({
      version: 2,
      scrypt: { ...scryptParams, salt: salt.toString('hex') },
    }))
    await this.deps.storage.writeWrappedKey(wrapped)
  }
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
  return {
    N: positiveInteger(params.N, 'scrypt N'),
    r: positiveInteger(params.r, 'scrypt r'),
    p: positiveInteger(params.p, 'scrypt p'),
    keylen: positiveInteger(params.keylen, 'scrypt key length'),
    salt: requireHex(params.salt, 'scrypt salt'),
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

function requireHex(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}
