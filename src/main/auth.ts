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
  SECRET_REVEAL_CONFIRM_PHRASE,
  validateMasterPasswordInput,
  validatePasswordInput,
  validatePlaintextExportConfirmation,
  validateSecretRevealConfirmation,
} from './security'
import { DEFAULT_LOCAL_FOLDERS } from '../shared/defaultLocalFolders'
import { VaultValidationError } from '../shared/vaultValidation'
import { UnsupportedMultiVaultCollectionError } from './vaultCollectionCompatibility'
import {
  AUTH_SETUP_INTERRUPTED_MESSAGE,
  type AuthErrorCode,
} from '../shared/authIpcContracts'
import { safeDiagnosticErrorCode } from './errorDiagnostics'
import {
  canonicalRecoveryCode,
  createRecoveryKit,
  markRecoveryKitVerified,
  metadataForRecoveryEnvelope,
  unwrapRecoveryKit,
  type RecoveryKitCrypto,
  type RecoveryKitEnvelope,
  type RecoveryKitMaterial,
} from './recoveryKit'

export interface AuthStorage {
  ensureVaultDir(): Promise<void>
  getAuthStateStatus(): Promise<AuthStateStatus>
  readCredentials(): Promise<{ paramsRaw: string; wrappedKey: Buffer }>
  readRecoveryCredentials?(): Promise<{ paramsRaw: string; wrappedKey: Buffer }>
  readVault(key: Buffer): Promise<unknown>
  validateVaultBackupSnapshot(snapshot: VaultBackupSnapshot, vaultKey: Buffer): Promise<Record<string, unknown>>
  createVaultState(
    input: {
      paramsRaw: string
      wrappedKey: Buffer
      vaultJson: string
      vaultKey: Buffer
      recoveryEnvelope?: RecoveryKitEnvelope
    },
    assertCurrent: () => void,
  ): Promise<void>
  commitAuthCredentials(paramsRaw: string, wrappedKey: Buffer, assertCurrent: () => void): Promise<void>
  readRecoveryEnvelope?(): Promise<RecoveryKitEnvelope | null>
  commitRecoveryEnvelope?(
    recoveryEnvelope: RecoveryKitEnvelope | null,
    assertCurrent: () => void,
  ): Promise<void>
  commitAuthAndRecoveryCredentials?(
    paramsRaw: string,
    wrappedKey: Buffer,
    recoveryEnvelope: RecoveryKitEnvelope,
    assertCurrent: () => void,
  ): Promise<void>
  commitRestoredVaultState(
    snapshot: VaultBackupSnapshot,
    vaultKey: Buffer,
    assertCurrent: () => void,
    replacement?: {
      paramsRaw: string
      wrappedKey: Buffer
      recoveryEnvelope: RecoveryKitEnvelope
    },
  ): Promise<void>
}

export interface AuthKeychain {
  isMac: boolean
  store(hexKey: string): boolean
  retrieve(prompt?: string, policy?: 'standard' | 'biometric-only'): KeychainResult
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
  recoveryCrypto?: RecoveryKitCrypto
  nowMs?: () => number
}

type AuthFailure = {
      success: false
      error: string
      errorCode?: AuthErrorCode
      cancelled?: boolean
      notFound?: boolean
      authFailed?: boolean
      touchIdInvalid?: boolean
      wrongPassword?: boolean
      alreadySetup?: boolean
      incomplete?: boolean
      sessionChanged?: boolean
      wrongRecoveryCode?: boolean
      retryAfterMs?: number
    }

type AuthResult<T = unknown> =
  | { success: true; data?: T; touchIdRestored?: boolean; recoveryKit?: RecoveryKitMaterial }
  | AuthFailure

export class AuthController {
  private readonly crypto: AuthCrypto
  private recoveryFailures = 0
  private recoveryRetryAt = 0

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
    let passwordValidated = false
    try {
      const masterPassword = validateMasterPasswordInput(password, 'master password')
      passwordValidated = true
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

      const recovery = await createRecoveryKit(newVaultKey, this.deps.recoveryCrypto)
      operation.assertCurrent()

      await this.deps.storage.createVaultState({
        paramsRaw,
        wrappedKey: wrapped,
        vaultJson: JSON.stringify(emptyVault),
        vaultKey: newVaultKey,
        recoveryEnvelope: recovery.envelope,
      }, operation.assertCurrent)
      operation.assertCurrent()

      if (!this.deps.session.installKey(newVaultKey, operation.epoch)) {
        return sessionChangedResult()
      }
      const touchIdRestored = this.deps.keychain.store(newVaultKey.toString('hex'))
      this.deps.recordAudit('vault.setup', { method: 'password' })
      this.deps.recordAudit('vault.recovery-kit.created', {
        generation: recovery.material.generation,
        vaultFingerprint: recovery.material.vaultFingerprint,
      })
      return {
        success: true,
        data: emptyVault,
        touchIdRestored,
        recoveryKit: recovery.material,
      }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      const message = errorMessage(err)
      if (/already initialized|cannot replace/i.test(message)) {
        return { success: false, alreadySetup: true, error: message }
      }
      if (!passwordValidated) return { success: false, error: message }
      console.error('[vault-auth] Vault setup failed', {
        code: safeDiagnosticErrorCode(err),
      })
      return {
        success: false,
        errorCode: 'setup_interrupted',
        error: AUTH_SETUP_INTERRUPTED_MESSAGE,
      }
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
      if (err instanceof UnsupportedMultiVaultCollectionError) return unsupportedMultiVaultResult()
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
      if (err instanceof UnsupportedMultiVaultCollectionError) return unsupportedMultiVaultResult()
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

  async recoveryStatus(): Promise<AuthResult<{
    configured: boolean
    metadata?: ReturnType<typeof metadataForRecoveryEnvelope>
  }>> {
    try {
      const storage = this.recoveryStorage()
      const envelope = await storage.readRecoveryEnvelope()
      return {
        success: true,
        data: envelope
          ? { configured: true, metadata: metadataForRecoveryEnvelope(envelope) }
          : { configured: false },
      }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  }

  async createOrRotateRecoveryKit(payload?: { currentPassword?: unknown }): Promise<AuthResult<RecoveryKitMaterial>> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) {
      operation.release()
      return { success: false, error: 'Not authenticated' }
    }
    let confirmedKey: Buffer | null = null
    try {
      const currentPassword = validatePasswordInput(payload?.currentPassword, 'current password')
      confirmedKey = await this.unwrapPasswordKey(currentPassword, operation.assertCurrent)
      vaultKey.assertCurrent()
      if (!this.crypto.sameKey(confirmedKey, vaultKey.key)) {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }
      const recovery = await createRecoveryKit(vaultKey.key, this.deps.recoveryCrypto)
      const assertCurrent = () => {
        operation.assertCurrent()
        vaultKey.assertCurrent()
      }
      assertCurrent()
      await this.recoveryStorage().commitRecoveryEnvelope(recovery.envelope, assertCurrent)
      this.deps.recordAudit('vault.recovery-kit.rotated', {
        generation: recovery.material.generation,
        vaultFingerprint: recovery.material.vaultFingerprint,
      })
      return { success: true, data: recovery.material }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      if (/wrong key|unable to authenticate|authenticate data/i.test(errorMessage(err))) {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }
      return { success: false, error: errorMessage(err) }
    } finally {
      confirmedKey?.fill(0)
      vaultKey.release()
      operation.release()
    }
  }

  async verifyRecoveryKit(recoveryCode: unknown): Promise<AuthResult<ReturnType<typeof metadataForRecoveryEnvelope>>> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) {
      operation.release()
      return { success: false, error: 'Not authenticated' }
    }
    let recoveredKey: Buffer | null = null
    try {
      const throttled = this.recoveryThrottleResult()
      if (throttled) return throttled
      const storage = this.recoveryStorage()
      const envelope = await storage.readRecoveryEnvelope()
      if (!envelope) return { success: false, error: 'No Emergency Kit is configured for this vault' }
      try {
        recoveredKey = await unwrapRecoveryKit(envelope, validateRecoveryCodeInput(recoveryCode), this.deps.recoveryCrypto)
      } catch {
        return this.recordRecoveryFailure()
      }
      operation.assertCurrent()
      vaultKey.assertCurrent()
      if (!this.crypto.sameKey(recoveredKey, vaultKey.key)) return this.recordRecoveryFailure()
      const verified = markRecoveryKitVerified(envelope)
      const assertCurrent = () => {
        operation.assertCurrent()
        vaultKey.assertCurrent()
      }
      await storage.commitRecoveryEnvelope(verified, assertCurrent)
      this.resetRecoveryThrottle()
      const metadata = metadataForRecoveryEnvelope(verified)
      this.deps.recordAudit('vault.recovery-kit.verified', {
        generation: metadata.generation,
        vaultFingerprint: metadata.vaultFingerprint,
      })
      return { success: true, data: metadata }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      recoveredKey?.fill(0)
      vaultKey.release()
      operation.release()
    }
  }

  async recoveryMaterialForPdf(recoveryCode: unknown): Promise<AuthResult<RecoveryKitMaterial>> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) {
      operation.release()
      return { success: false, error: 'Not authenticated' }
    }
    let recoveredKey: Buffer | null = null
    try {
      const throttled = this.recoveryThrottleResult()
      if (throttled) return throttled
      const envelope = await this.recoveryStorage().readRecoveryEnvelope()
      if (!envelope) return { success: false, error: 'No Emergency Kit is configured for this vault' }
      const canonicalCode = canonicalRecoveryCode(validateRecoveryCodeInput(recoveryCode))
      try {
        recoveredKey = await unwrapRecoveryKit(envelope, canonicalCode, this.deps.recoveryCrypto)
      } catch {
        return this.recordRecoveryFailure()
      }
      operation.assertCurrent()
      vaultKey.assertCurrent()
      if (!this.crypto.sameKey(recoveredKey, vaultKey.key)) return this.recordRecoveryFailure()
      this.resetRecoveryThrottle()
      return {
        success: true,
        data: {
          ...metadataForRecoveryEnvelope(envelope),
          recoveryCode: canonicalCode,
        },
      }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      recoveredKey?.fill(0)
      vaultKey.release()
      operation.release()
    }
  }

  async revokeRecoveryKit(payload?: { currentPassword?: unknown }): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) {
      operation.release()
      return { success: false, error: 'Not authenticated' }
    }
    let confirmedKey: Buffer | null = null
    try {
      const currentPassword = validatePasswordInput(payload?.currentPassword, 'current password')
      confirmedKey = await this.unwrapPasswordKey(currentPassword, operation.assertCurrent)
      vaultKey.assertCurrent()
      if (!this.crypto.sameKey(confirmedKey, vaultKey.key)) {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }
      const assertCurrent = () => {
        operation.assertCurrent()
        vaultKey.assertCurrent()
      }
      await this.recoveryStorage().commitRecoveryEnvelope(null, assertCurrent)
      this.resetRecoveryThrottle()
      this.deps.recordAudit('vault.recovery-kit.revoked')
      return { success: true }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      if (/wrong key|unable to authenticate|authenticate data/i.test(errorMessage(err))) {
        return { success: false, wrongPassword: true, error: 'Current password is incorrect' }
      }
      return { success: false, error: errorMessage(err) }
    } finally {
      confirmedKey?.fill(0)
      vaultKey.release()
      operation.release()
    }
  }

  async recoverWithKit(payload?: {
    recoveryCode?: unknown
    newPassword?: unknown
  }): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    let recoveredKey: Buffer | null = null
    let newWrappingKey: Buffer | null = null
    try {
      const throttled = this.recoveryThrottleResult()
      if (throttled) return throttled
      const recoveryCode = validateRecoveryCodeInput(payload?.recoveryCode)
      const newPassword = validateMasterPasswordInput(payload?.newPassword, 'new password')
      const storage = this.recoveryStorage()
      const envelope = await storage.readRecoveryEnvelope()
      if (!envelope) return { success: false, error: 'No Emergency Kit is configured for this vault' }
      try {
        recoveredKey = await unwrapRecoveryKit(envelope, recoveryCode, this.deps.recoveryCrypto)
      } catch {
        return this.recordRecoveryFailure()
      }
      const rawData = await this.deps.storage.readVault(recoveredKey)
      operation.assertCurrent()
      const data = this.normalizeVaultData(rawData)

      const newSalt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      newWrappingKey = await this.crypto.scrypt(newPassword, newSalt, scryptParams)
      operation.assertCurrent()
      const newWrapped = this.crypto.seal(recoveredKey, newWrappingKey)
      const replacement = await createRecoveryKit(recoveredKey, this.deps.recoveryCrypto)
      await storage.commitAuthAndRecoveryCredentials(
        serializeParams(scryptParams, newSalt),
        newWrapped,
        replacement.envelope,
        operation.assertCurrent,
      )
      operation.assertCurrent()
      if (!this.deps.session.installKey(recoveredKey, operation.epoch)) return sessionChangedResult()
      const touchIdRestored = this.deps.keychain.store(recoveredKey.toString('hex'))
      this.resetRecoveryThrottle()
      this.deps.recordAudit('vault.recovery-kit.used', {
        priorGeneration: envelope.generation,
        replacementGeneration: replacement.material.generation,
        vaultFingerprint: replacement.material.vaultFingerprint,
      })
      return {
        success: true,
        data,
        touchIdRestored,
        recoveryKit: replacement.material,
      }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      recoveredKey?.fill(0)
      newWrappingKey?.fill(0)
      operation.release()
    }
  }

  async restoreBackupWithKit(
    snapshot: VaultBackupSnapshot,
    payload?: { recoveryCode?: unknown; newPassword?: unknown },
  ): Promise<AuthResult> {
    const operation = this.deps.session.beginOperation()
    if (!operation) return sessionChangedResult()
    let recoveredKey: Buffer | null = null
    let newWrappingKey: Buffer | null = null
    try {
      const throttled = this.recoveryThrottleResult()
      if (throttled) return throttled
      const state = await this.deps.storage.getAuthStateStatus()
      if (state !== 'missing') {
        return {
          success: false,
          error: state === 'incomplete'
            ? 'Existing vault authentication state is incomplete; do not replace it from first-run recovery'
            : 'A vault already exists. Use the locked-vault Emergency Kit flow instead.',
        }
      }
      if (!snapshot.recoveryEnvelope) {
        return { success: false, error: 'This backup predates Emergency Kit recovery' }
      }
      const recoveryCode = validateRecoveryCodeInput(payload?.recoveryCode)
      const newPassword = validateMasterPasswordInput(payload?.newPassword, 'new password')
      try {
        recoveredKey = await unwrapRecoveryKit(
          snapshot.recoveryEnvelope,
          recoveryCode,
          this.deps.recoveryCrypto,
        )
      } catch {
        return this.recordRecoveryFailure()
      }
      operation.assertCurrent()

      const newSalt = this.crypto.randomSalt()
      const scryptParams = currentScryptParams()
      newWrappingKey = await this.crypto.scrypt(newPassword, newSalt, scryptParams)
      operation.assertCurrent()
      const newWrapped = this.crypto.seal(recoveredKey, newWrappingKey)
      const replacement = await createRecoveryKit(recoveredKey, this.deps.recoveryCrypto)
      await this.deps.storage.commitRestoredVaultState(
        snapshot,
        recoveredKey,
        operation.assertCurrent,
        {
          paramsRaw: serializeParams(scryptParams, newSalt),
          wrappedKey: newWrapped,
          recoveryEnvelope: replacement.envelope,
        },
      )
      operation.assertCurrent()
      const rawData = await this.deps.storage.readVault(recoveredKey)
      operation.assertCurrent()
      const data = this.normalizeVaultData(rawData)
      if (!this.deps.session.installKey(recoveredKey, operation.epoch)) return sessionChangedResult()
      const touchIdRestored = this.deps.keychain.store(recoveredKey.toString('hex'))
      this.resetRecoveryThrottle()
      this.deps.recordAudit('vault.recovery-kit.used', {
        source: 'backup',
        priorGeneration: snapshot.recoveryEnvelope.generation,
        replacementGeneration: replacement.material.generation,
        vaultFingerprint: replacement.material.vaultFingerprint,
      })
      return {
        success: true,
        data,
        touchIdRestored,
        recoveryKit: replacement.material,
      }
    } catch (err) {
      if (err instanceof VaultSessionChangedError) return sessionChangedResult()
      return { success: false, error: errorMessage(err) }
    } finally {
      recoveredKey?.fill(0)
      newWrappingKey?.fill(0)
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
      try {
        restoredVaultKey = this.crypto.open(snapshot.wrappedKey, backupWrappingKey)
        await this.deps.storage.validateVaultBackupSnapshot(snapshot, restoredVaultKey)
      } catch {
        return { success: false, wrongPassword: true, error: 'Backup password is incorrect or the backup is damaged' }
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

  confirmUnlockedKeychain(
    prompt: string,
    policy: 'standard' | 'biometric-only' = 'standard',
  ): AuthResult {
    const vaultKey = this.deps.session.leaseCurrentKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      if (!this.deps.keychain.isMac) return { success: false, notFound: true, error: 'Touch ID unavailable' }

      const result = this.deps.keychain.retrieve(prompt, policy)
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

  confirmAgentApproval(prompt: string, _phrase?: string): AuthResult {
    if (this.deps.keychain.isMac) return this.confirmUnlockedKeychain(prompt, 'biometric-only')
    return {
      success: false,
      notFound: true,
      error: 'Agent approval requires native biometric user presence',
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

  private recoveryStorage(): Required<Pick<
    AuthStorage,
    'readRecoveryEnvelope' | 'commitRecoveryEnvelope' | 'commitAuthAndRecoveryCredentials'
  >> {
    const storage = this.deps.storage
    if (
      !storage.readRecoveryEnvelope
      || !storage.commitRecoveryEnvelope
      || !storage.commitAuthAndRecoveryCredentials
    ) {
      throw new Error('Recovery storage is unavailable')
    }
    return {
      readRecoveryEnvelope: storage.readRecoveryEnvelope.bind(storage),
      commitRecoveryEnvelope: storage.commitRecoveryEnvelope.bind(storage),
      commitAuthAndRecoveryCredentials: storage.commitAuthAndRecoveryCredentials.bind(storage),
    }
  }

  private async unwrapPasswordKey(password: string, assertCurrent: () => void): Promise<Buffer> {
    let wrappingKey: Buffer | null = null
    try {
      const credentials = await this.deps.storage.readCredentials()
      const sp = storedScryptParams(JSON.parse(credentials.paramsRaw).scrypt)
      wrappingKey = await this.crypto.scrypt(password, Buffer.from(sp.salt, 'hex'), sp)
      assertCurrent()
      return this.crypto.open(credentials.wrappedKey, wrappingKey)
    } finally {
      wrappingKey?.fill(0)
    }
  }

  private recoveryThrottleResult(): AuthFailure | null {
    const remaining = this.recoveryRetryAt - (this.deps.nowMs?.() ?? Date.now())
    if (remaining <= 0) return null
    return {
      success: false,
      wrongRecoveryCode: true,
      retryAfterMs: remaining,
      error: `Wait ${Math.ceil(remaining / 1_000)} seconds before trying the Emergency Kit again`,
    }
  }

  private recordRecoveryFailure(): AuthFailure {
    this.recoveryFailures += 1
    const delayMs = Math.min(30_000, 1_000 * (2 ** Math.min(this.recoveryFailures - 1, 5)))
    this.recoveryRetryAt = (this.deps.nowMs?.() ?? Date.now()) + delayMs
    return {
      success: false,
      wrongRecoveryCode: true,
      retryAfterMs: delayMs,
      error: 'Emergency Kit code is incorrect, damaged, or belongs to another vault',
    }
  }

  private resetRecoveryThrottle(): void {
    this.recoveryFailures = 0
    this.recoveryRetryAt = 0
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

function sessionChangedResult(): AuthFailure {
  return {
    success: false,
    sessionChanged: true,
    error: 'Vault session changed; unlock and try again',
  }
}

function unsupportedMultiVaultResult(): AuthFailure {
  return {
    success: false,
    error: 'This vault contains multiple vaults created by a newer Vaultage build. Open it with a Vaultage version that supports multiple vaults; do not restore an older backup.',
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

function validateRecoveryCodeInput(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Recovery code is required')
  }
  if (Buffer.byteLength(value, 'utf8') > 256) throw new Error('Recovery code is too large')
  return value
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
