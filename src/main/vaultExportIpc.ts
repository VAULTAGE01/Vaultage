import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { Buffer } from 'buffer'
import { atomicWritePrivateFile } from './fileIO'
import { validateMasterPasswordInput, validatePasswordInput } from './security'
import { currentScryptParams, open, randomSalt, scrypt, seal, type ScryptParams } from './vaultCrypto'
import { readVault } from './vaultStorage'
import {
  serializeScopedVaultExportCsv,
  serializeScopedVaultExportJson,
  type VaultExportFormat,
  type VaultExportScope,
} from '../shared/vaultExport'
import { vaultIpcContracts } from '../shared/vaultIpcContracts'
import { validateVaultImportPayload } from '../shared/vaultValidation'
import type { VaultIpcDeps } from './vaultIpcCommon'

export function registerVaultExportIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  const vaultIpc = vaultIpcContracts

  ipcMain.handle(vaultIpc.exportJson.channel, async (_, rawPayload: unknown) => {
    try {
      const payload = vaultIpc.exportJson.validate(rawPayload)
      return await exportScopedVault(deps, {
        scope: { kind: 'vault' },
        format: 'json',
        plaintextConfirmation: payload.plaintextConfirmation,
      })
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.exportScope.channel, async (_, rawPayload: unknown) => {
    try {
      const payload = vaultIpc.exportScope.validate(rawPayload)
      return await exportScopedVault(deps, {
        scope: payload.scope,
        format: payload.format,
        plaintextConfirmation: payload.plaintextConfirmation,
        encryptionPassword: payload.encryptionPassword,
      })
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.decryptExport.channel, async (_, rawPayload: unknown) => {
    try {
      const payload = vaultIpc.decryptExport.validate(rawPayload)
      const data = validateImportExportText(payload.data)
      const password = validatePasswordInput(payload.password, 'export password')
      return { success: true, data: await decryptScopedVaultExport(data, password) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
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
  const operation = deps.beginSessionOperation()
  if (!operation) return { success: false, error: 'Not authenticated' }
  try {
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
      operation.assertCurrent()
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
      operation.assertCurrent()
      await atomicWritePrivateFile(result.filePath!, fileContent, {
        beforeCommit: operation.assertCurrent,
      })
      operation.assertCurrent()
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
  } finally {
    operation.release()
  }
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
    const plaintext = open(payload, key)
    try {
      let decoded: unknown
      try {
        decoded = JSON.parse(plaintext.toString('utf8')) as unknown
      } catch {
        throw new Error('Decrypted export payload is not valid JSON')
      }
      validateVaultImportPayload(decoded, { boundary: 'import' })
      return decoded
    } finally {
      plaintext.fill(0)
    }
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
  if (!salt || salt.length < 32 || salt.length > 256) {
    throw new Error('Encrypted export salt is invalid')
  }
  const supported = currentScryptParams()
  return {
    N: supportedScryptN(record.N, supported.N),
    r: supportedInteger(record.r, supported.r, 'r'),
    p: supportedInteger(record.p, supported.p, 'p'),
    keylen: supportedInteger(record.keylen, supported.keylen, 'key length'),
    salt,
  }
}

function supportedScryptN(value: unknown, maximum: number): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 16_384
    || value > maximum
    || (value & (value - 1)) !== 0
  ) {
    throw new Error('Encrypted export N is invalid')
  }
  return value
}

function supportedInteger(value: unknown, expected: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value !== expected) {
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
