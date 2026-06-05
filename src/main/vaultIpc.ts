import { BrowserWindow, clipboard, dialog, nativeImage, type IpcMain } from 'electron'
import { Buffer } from 'buffer'
import { timingSafeEqual } from 'crypto'
import { join } from 'path'
import type { AuditEventType } from './audit'
import type { AuthController } from './auth'
import { atomicWritePrivateFile, copyPrivateFile, ensurePrivateDir } from './fileIO'
import {
  validateMasterPasswordInput,
  validatePasswordInput,
  validateQuickRevealPinInput,
  validateVaultSaveJson,
} from './security'
import { currentScryptParams, open, randomSalt, scrypt, seal, type ScryptParams } from './vaultCrypto'
import {
  serializeScopedVaultExportCsv,
  serializeScopedVaultExportJson,
  type VaultExportFormat,
  type VaultExportScope,
} from '../shared/vaultExport'
import {
  PARAMS_FILE,
  VAULT_FILE,
  WRAPPED_KEY_FILE,
  readVault,
  updateVault,
} from './vaultStorage'
import { copySecretFieldInVault, revealSecretFieldsInVault, trackSecretUsageInVault } from './vaultMutations'
import { mergeRedactedVaultValues, redactVaultForRenderer } from './vaultRedaction'

export interface VaultIpcDeps {
  getVaultKey: () => Buffer | null
  getVaultRevision: () => number
  setVaultRevision: (revision: number) => void
  lockVault: (notifyRenderer?: boolean, reason?: string) => void
  authController: AuthController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  quitApp?: () => void
}

export function registerVaultIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  ipcMain.handle('vault:save', async (_, json: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const safeJson = validateVaultSaveJson(json)
      const parsed = JSON.parse(safeJson) as Record<string, unknown>
      const expectedRevision = typeof parsed.revision === 'number' ? parsed.revision : 0
      const result = await updateVault(vaultKey, (currentVault) => {
        const currentRevision = vaultRevisionFrom(currentVault, deps.getVaultRevision())
        if (expectedRevision !== currentRevision) throw new StaleVaultSaveError(currentRevision)
        const nextRevision = currentRevision + 1
        const merged = mergeRedactedVaultValues(parsed, currentVault) as Record<string, unknown>
        const next = { ...merged, revision: nextRevision }
        const nextJson = validateVaultSaveJson(JSON.stringify(next))
        return {
          json: nextJson,
          result: {
            revision: nextRevision,
            data: redactVaultForRenderer(next),
          },
        }
      })
      deps.setVaultRevision(result.revision)
      return { success: true, revision: result.revision, data: result.data }
    } catch (err) {
      if (err instanceof StaleVaultSaveError) {
        return {
          success: false,
          stale: true,
          error: 'Vault changed since this screen last saved. Lock and unlock to refresh before saving again.',
          revision: err.currentRevision,
        }
      }
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:track-usage', async (_, payload?: { secretId?: unknown }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const revision = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const next = {
          ...(trackSecretUsageInVault(vault, payload?.secretId) as Record<string, unknown>),
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return { json: safeJson, result: nextRevision }
      })
      deps.setVaultRevision(revision)
      return { success: true, revision }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:copy-secret-field', async (_, payload?: {
    secretId?: unknown
    fieldKey?: unknown
    clearAfterMs?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      let copiedValue = ''
      const clearAfterMs = clipboardClearAfterMs(payload?.clearAfterMs)
      const revision = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const result = copySecretFieldInVault(vault, payload?.secretId, payload?.fieldKey)
        if (result.value.length > 1_000_000) {
          throw new Error('Clipboard text is too large')
        }
        const next = {
          ...(result.vault as Record<string, unknown>),
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        clipboard.writeText(result.value)
        copiedValue = result.value
        return { json: safeJson, result: nextRevision }
      })
      deps.setVaultRevision(revision)
      deps.recordAudit('vault.secret.copied', {
        vaultItemId: payload?.secretId,
        field: payload?.fieldKey,
        kind: 'text',
      })
      if (clearAfterMs > 0 && copiedValue) {
        const timer = setTimeout(() => {
          if (clipboard.readText() === copiedValue) clipboard.writeText('')
        }, clearAfterMs)
        timer.unref?.()
      }
      return { success: true, revision }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:copy-secret-image-field', async (_, payload?: {
    secretId?: unknown
    fieldKey?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const revision = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const result = copySecretFieldInVault(vault, payload?.secretId, payload?.fieldKey)
        const next = {
          ...(result.vault as Record<string, unknown>),
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        writeImageDataUrlToClipboard(result.value)
        return { json: safeJson, result: nextRevision }
      })
      deps.setVaultRevision(revision)
      deps.recordAudit('vault.secret.copied', {
        vaultItemId: payload?.secretId,
        field: payload?.fieldKey,
        kind: 'image',
      })
      return { success: true, revision }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:reveal-secret-field', async (_, payload?: {
    secretId?: unknown
    fieldKey?: unknown
    confirmationPhrase?: unknown
    pin?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const pin = optionalQuickRevealPin(payload?.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Reveal saved secret value from Vaultage',
          typeof payload?.confirmationPhrase === 'string' ? payload.confirmationPhrase : undefined,
        )
        if (!confirmation.success) return confirmation
      }
      let value = ''
      const revision = await updateVault(vaultKey, async (vault) => {
        if (pin) await requireQuickRevealPin(vault, pin)
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const result = copySecretFieldInVault(vault, payload?.secretId, payload?.fieldKey)
        if (Buffer.byteLength(result.value, 'utf8') > 1_000_000) {
          throw new Error('Secret field is too large to reveal')
        }
        value = result.value
        const next = {
          ...(result.vault as Record<string, unknown>),
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return { json: safeJson, result: nextRevision }
      })
      deps.setVaultRevision(revision)
      deps.recordAudit('vault.secret.revealed', {
        vaultItemId: payload?.secretId,
        field: payload?.fieldKey,
        kind: 'text',
        method: pin ? 'pin' : 'system',
      })
      return { success: true, revision, value }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:reveal-secret-image-field', async (_, payload?: {
    secretId?: unknown
    fieldKey?: unknown
    confirmationPhrase?: unknown
    pin?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const pin = optionalQuickRevealPin(payload?.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Reveal saved secret image from Vaultage',
          typeof payload?.confirmationPhrase === 'string' ? payload.confirmationPhrase : undefined,
        )
        if (!confirmation.success) return confirmation
      }
      let value = ''
      const revision = await updateVault(vaultKey, async (vault) => {
        if (pin) await requireQuickRevealPin(vault, pin)
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const result = copySecretFieldInVault(vault, payload?.secretId, payload?.fieldKey)
        validateImageDataUrl(result.value)
        value = result.value
        const next = {
          ...(result.vault as Record<string, unknown>),
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return { json: safeJson, result: nextRevision }
      })
      deps.setVaultRevision(revision)
      deps.recordAudit('vault.secret.revealed', {
        vaultItemId: payload?.secretId,
        field: payload?.fieldKey,
        kind: 'image',
        method: pin ? 'pin' : 'system',
      })
      return { success: true, revision, value }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:reveal-secret-fields', async (_, payload?: {
    secretId?: unknown
    confirmationPhrase?: unknown
    pin?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const pin = optionalQuickRevealPin(payload?.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Reveal pinned secret values from Vaultage',
          typeof payload?.confirmationPhrase === 'string' ? payload.confirmationPhrase : undefined,
        )
        if (!confirmation.success) return confirmation
      }
      let fields: { key: string; value: string; sensitive: boolean }[] = []
      const revision = await updateVault(vaultKey, async (vault) => {
        if (pin) await requireQuickRevealPin(vault, pin)
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const result = revealSecretFieldsInVault(vault, payload?.secretId)
        const totalBytes = result.fields.reduce((sum, field) => sum + Buffer.byteLength(field.value, 'utf8'), 0)
        if (totalBytes > 1_000_000) throw new Error('Secret is too large to reveal')
        fields = result.fields
        const next = {
          ...(result.vault as Record<string, unknown>),
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return { json: safeJson, result: nextRevision }
      })
      deps.setVaultRevision(revision)
      deps.recordAudit('vault.secret.revealed', {
        vaultItemId: payload?.secretId,
        kind: 'fields',
        method: pin ? 'pin' : 'system',
      })
      return { success: true, revision, fields }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:set-reveal-pin', async (_, payload?: {
    pin?: unknown
    masterPassword?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const pin = validateQuickRevealPinInput(payload?.pin)
      const verified = await deps.authController.verifyMasterPassword(payload?.masterPassword)
      if (!verified.success) return verified
      const quickRevealPin = await createQuickRevealPinRecord(pin)
      const result = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const current = isRecord(vault) ? vault : {}
        const preferences = isRecord(current.preferences) ? current.preferences : {}
        const next = {
          ...current,
          revision: nextRevision,
          preferences: {
            ...preferences,
            quickRevealPin,
            quickRevealPinEnabled: true,
          },
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return {
          json: safeJson,
          result: {
            revision: nextRevision,
            data: redactVaultForRenderer(next),
          },
        }
      })
      deps.setVaultRevision(result.revision)
      deps.recordAudit('vault.reveal_pin.changed', { action: 'set' })
      return { success: true, revision: result.revision, data: result.data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:clear-reveal-pin', async (_, payload?: {
    masterPassword?: unknown
  }) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const verified = await deps.authController.verifyMasterPassword(payload?.masterPassword)
      if (!verified.success) return verified
      const result = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const current = isRecord(vault) ? vault : {}
        const preferences = isRecord(current.preferences) ? cloneRecord(current.preferences) : {}
        delete preferences.quickRevealPin
        preferences.quickRevealPinEnabled = false
        const next = {
          ...current,
          revision: nextRevision,
          preferences,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return {
          json: safeJson,
          result: {
            revision: nextRevision,
            data: redactVaultForRenderer(next),
          },
        }
      })
      deps.setVaultRevision(result.revision)
      deps.recordAudit('vault.reveal_pin.changed', { action: 'clear' })
      return { success: true, revision: result.revision, data: result.data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:lock', () => {
    deps.lockVault(false, 'manual')
    return { success: true }
  })

  ipcMain.handle('vault:sign-out', () => {
    const forgetResult = deps.authController.forgetTouchID()
    if (!forgetResult.success) return forgetResult
    deps.lockVault(false, 'sign-out')
    deps.quitApp?.()
    return { success: true }
  })

  ipcMain.handle('vault:backup', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Choose backup destination',
    })
    if (result.canceled) return { success: false, cancelled: true }

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const backupDir = join(result.filePaths[0], `vault-backup-${stamp}`)
      await ensurePrivateDir(backupDir)
      await copyPrivateFile(VAULT_FILE, join(backupDir, 'vault.enc'))
      await copyPrivateFile(WRAPPED_KEY_FILE, join(backupDir, 'key.wrapped'))
      await copyPrivateFile(PARAMS_FILE, join(backupDir, 'params.json'))
      return { success: true, path: backupDir }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:export-json', async (_, payload?: { plaintextConfirmation?: string }) => {
    return exportScopedVault(deps, {
      scope: { kind: 'vault' },
      format: 'json',
      plaintextConfirmation: payload?.plaintextConfirmation,
    })
  })

  ipcMain.handle('vault:export-scope', async (_, payload?: {
    scope?: unknown
    format?: unknown
    plaintextConfirmation?: string
    encryptionPassword?: unknown
  }) => {
    try {
      return await exportScopedVault(deps, {
        scope: validateExportScope(payload?.scope),
        format: validateExportFormat(payload?.format),
        plaintextConfirmation: payload?.plaintextConfirmation,
        encryptionPassword: payload?.encryptionPassword,
      })
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('vault:decrypt-export', async (_, payload?: {
    data?: unknown
    password?: unknown
  }) => {
    try {
      const data = validateImportExportText(payload?.data)
      const password = validatePasswordInput(payload?.password, 'export password')
      return { success: true, data: await decryptScopedVaultExport(data, password) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}

function optionalQuickRevealPin(pin: unknown): string | undefined {
  if (pin === undefined || pin === null || pin === '') return undefined
  return validateQuickRevealPinInput(pin)
}

async function createQuickRevealPinRecord(pin: string): Promise<QuickRevealPinRecord> {
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

async function requireQuickRevealPin(vault: unknown, pin: string): Promise<void> {
  const record = quickRevealPinRecord(vault)
  if (!record) throw new Error('Reveal PIN is not configured')
  const expected = Buffer.from(record.verifier, 'hex')
  const actual = await deriveQuickRevealPin(pin, Buffer.from(record.scrypt.salt, 'hex'), record.scrypt)
  try {
    if (expected.byteLength === 0 || expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
      throw new Error('Incorrect PIN')
    }
  } finally {
    expected.fill(0)
    actual.fill(0)
  }
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
  if (!salt) throw new Error('Reveal PIN verifier is invalid')
  return {
    N: quickRevealPinPositiveInteger(value.N),
    r: quickRevealPinPositiveInteger(value.r),
    p: quickRevealPinPositiveInteger(value.p),
    keylen: quickRevealPinPositiveInteger(value.keylen),
    salt,
  }
}

function quickRevealPinPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Reveal PIN verifier is invalid')
  }
  return value
}

interface QuickRevealPinKdf extends Required<ScryptParams> {
  salt: string
}

interface QuickRevealPinRecord {
  version: 1
  scrypt: QuickRevealPinKdf
  verifier: string
  updatedAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value }
}

async function exportScopedVault(
  deps: VaultIpcDeps,
  payload: {
    scope: VaultExportScope
    format: VaultExportFormat
    plaintextConfirmation?: string
    encryptionPassword?: unknown
  },
): Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }> {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const isEncrypted = payload.format === 'encrypted'
    let exportPassword: string | null = null
    if (isEncrypted) {
      try {
        exportPassword = validateMasterPasswordInput(payload.encryptionPassword, 'export password')
      } catch (err) {
        return { success: false, error: String(err) }
      }
    } else {
      const confirmation = deps.authController.confirmPlaintextExport(
        `Confirm plaintext ${payload.format.toUpperCase()} export from Vaultage`,
        payload.plaintextConfirmation,
      )
      if (!confirmation.success) return confirmation
    }

    let exportData: ReturnType<typeof serializeScopedVaultExportJson>
    let fileContent = ''
    let fileStem = ''
    let extension = ''
    let filters: Electron.FileFilter[] = []
    try {
      const data = await readVault(vaultKey)
      exportData = payload.format === 'csv'
        ? serializeScopedVaultExportCsv(data, payload.scope)
        : serializeScopedVaultExportJson(data, payload.scope)
      if (isEncrypted) {
        fileContent = await encryptScopedVaultExport(exportData.content, exportPassword!)
        fileStem = exportData.fileStem
        extension = 'vaultage-export'
        filters = [{ name: 'Vaultage Encrypted Export', extensions: ['vaultage-export'] }]
      } else {
        fileContent = exportData.content
        fileStem = exportData.fileStem
        extension = payload.format
        filters = payload.format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'JSON', extensions: ['json'] }]
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }

    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: `Export ${exportData.scopeLabel}`,
      defaultPath: `${fileStem}.${extension}`,
      filters,
    })
    if (result.canceled) return { success: false, cancelled: true }

    try {
      await atomicWritePrivateFile(result.filePath!, fileContent)
      deps.recordAudit(isEncrypted ? 'vault.exported_encrypted' : 'vault.exported_plaintext', {
        filePath: result.filePath,
        scopeKind: payload.scope.kind,
        scopeId: 'id' in payload.scope ? payload.scope.id : undefined,
        format: payload.format,
        itemCount: exportData.itemCount,
      })
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
}

function validateExportFormat(format: unknown): VaultExportFormat {
  if (format === 'json' || format === 'csv' || format === 'encrypted') return format
  throw new Error('Invalid export format')
}

async function encryptScopedVaultExport(plainJson: string, password: string): Promise<string> {
  const salt = randomSalt()
  const params = currentScryptParams()
  const key = await scrypt(password, salt, params)
  try {
    return JSON.stringify({
      format: 'vaultage.encrypted-export.v1',
      cipher: 'aes-256-gcm',
      kdf: { ...params, salt: salt.toString('hex') },
      payload: seal(Buffer.from(plainJson, 'utf8'), key).toString('base64'),
    }, null, 2)
  } finally {
    key.fill(0)
  }
}

async function decryptScopedVaultExport(text: string, password: string): Promise<unknown> {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Encrypted export must be a JSON object')
  }
  const record = parsed as Record<string, unknown>
  if (record.format !== 'vaultage.encrypted-export.v1') {
    throw new Error('Unsupported encrypted export format')
  }
  if (record.cipher !== 'aes-256-gcm') throw new Error('Unsupported encrypted export cipher')
  const kdf = encryptedExportKdf(record.kdf)
  const payload = typeof record.payload === 'string' ? Buffer.from(record.payload, 'base64') : null
  if (!payload || payload.byteLength === 0) throw new Error('Encrypted export payload is missing')

  const key = await scrypt(password, Buffer.from(kdf.salt, 'hex'), kdf)
  try {
    return JSON.parse(open(payload, key).toString('utf8'))
  } finally {
    key.fill(0)
  }
}

interface EncryptedExportKdf extends Required<ScryptParams> {
  salt: string
}

function encryptedExportKdf(value: unknown): EncryptedExportKdf {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Encrypted export KDF is invalid')
  }
  const record = value as Record<string, unknown>
  const salt = typeof record.salt === 'string' && /^[0-9a-f]+$/i.test(record.salt) && record.salt.length % 2 === 0
    ? record.salt
    : null
  if (!salt) throw new Error('Encrypted export salt is invalid')
  return {
    N: positiveInteger(record.N, 'N'),
    r: positiveInteger(record.r, 'r'),
    p: positiveInteger(record.p, 'p'),
    keylen: positiveInteger(record.keylen, 'key length'),
    salt,
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Encrypted export ${label} is invalid`)
  }
  return value
}

function validateImportExportText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Encrypted export data must be text')
  if (Buffer.byteLength(value, 'utf8') > 20 * 1024 * 1024) {
    throw new Error('Encrypted export data is too large')
  }
  return value
}

function validateExportScope(scope: unknown): VaultExportScope {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('Invalid export scope')
  }
  const record = scope as Record<string, unknown>
  if (record.kind === 'vault') return { kind: 'vault' }
  if (record.kind === 'folder') return { kind: 'folder', id: validateExportId(record.id, 'folder id') }
  if (record.kind === 'secret') return { kind: 'secret', id: validateExportId(record.id, 'secret id') }
  throw new Error('Invalid export scope')
}

function validateExportId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid export ${label}`)
  }
  return value
}

class StaleVaultSaveError extends Error {
  constructor(readonly currentRevision: number) {
    super('Vault revision is stale')
  }
}

function vaultRevisionFrom(vault: unknown, fallback: number): number {
  if (vault && typeof vault === 'object' && !Array.isArray(vault)) {
    const revision = (vault as { revision?: unknown }).revision
    if (typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
      return revision
    }
  }
  return fallback > 0 ? fallback : 1
}

function clipboardClearAfterMs(value: unknown): number {
  if (value === undefined || value === null) return 30_000
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000
  if (value <= 0) return 0
  return Math.min(Math.floor(value), 120_000)
}

function writeImageDataUrlToClipboard(dataUrl: string): void {
  const bytes = validateImageDataUrl(dataUrl)
  const img = nativeImage.createFromBuffer(bytes)
  if (img.isEmpty()) throw new Error('Clipboard image is invalid')
  clipboard.writeImage(img)
}

function validateImageDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Invalid image data URL')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Clipboard image is too large')
  const img = nativeImage.createFromBuffer(bytes)
  if (img.isEmpty()) throw new Error('Clipboard image is invalid')
  return bytes
}
