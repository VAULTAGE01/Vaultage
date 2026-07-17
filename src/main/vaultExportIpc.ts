import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { Buffer } from 'buffer'
import { randomUUID } from 'crypto'
import { atomicWritePrivateFile } from './fileIO'
import { validateMasterPasswordInput, validatePasswordInput, validateVaultSaveJson } from './security'
import { currentScryptParams, open, randomSalt, scrypt, seal, type ScryptParams } from './vaultCrypto'
import { commitVaultUpdate, readVault } from './vaultStorage'
import { applyVaultMutationCommand } from './vaultCommandMutations'
import { deriveVaultCrudAuditEntries } from './vaultCrudAudit'
import { redactVaultForRenderer } from './vaultRedaction'
import {
  auditEntriesFromVaultMutationReceipt,
  fingerprintVaultMutationCommand,
  withVaultMutationReceipt,
} from './vaultMutationReceipts'
import {
  serializeScopedVaultExportCsv,
  serializeScopedVaultExportJson,
  type VaultExportFormat,
  type VaultExportScope,
} from '../shared/vaultExport'
import { templateCsv } from '../shared/csvImportTemplate'
import { vaultIpcContracts, type VaultMutationCommand } from '../shared/vaultIpcContracts'
import { validateVaultImportPayload, validateVaultRoot } from '../shared/vaultValidation'
import { StaleVaultMutationError, vaultRevisionFrom, type VaultIpcDeps } from './vaultIpcCommon'

const ENCRYPTED_IMPORT_TTL_MS = 2 * 60 * 1000
const ENCRYPTED_IMPORT_SESSION_CHECK_MS = 500

interface EncryptedImportSession {
  token: string
  webContentsId: number
  sessionEpoch: number
  revision: number
  expiresAtMs: number
  root: Record<string, unknown> | null
  selections: Map<string, string>
  monitor: ReturnType<typeof setInterval>
}

export function registerVaultExportIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  const vaultIpc = vaultIpcContracts
  const encryptedImports = new Map<string, EncryptedImportSession>()
  const encryptedImportAttemptBySender = new Map<number, number>()
  const encryptedImportSenderCleanupRegistered = new Set<number>()
  let nextEncryptedImportAttempt = 0

  const clearEncryptedImport = (token: string): void => {
    const session = encryptedImports.get(token)
    if (!session) return
    encryptedImports.delete(token)
    clearInterval(session.monitor)
    session.selections.clear()
    session.root = null
  }

  const clearEncryptedImportsForSender = (webContentsId: number): void => {
    for (const [token, session] of encryptedImports) {
      if (session.webContentsId === webContentsId) clearEncryptedImport(token)
    }
  }

  ipcMain.handle(vaultIpc.exportJson.channel, async (event, rawPayload: unknown) => {
    try {
      const payload = vaultIpc.exportJson.validate(rawPayload)
      return await exportScopedVault(deps, {
        scope: { kind: 'vault' },
        format: 'json',
        plaintextConfirmation: payload.plaintextConfirmation,
      }, BrowserWindow.fromWebContents(event.sender))
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.exportScope.channel, async (event, rawPayload: unknown) => {
    try {
      const payload = vaultIpc.exportScope.validate(rawPayload)
      return await exportScopedVault(deps, {
        scope: payload.scope,
        format: payload.format,
        plaintextConfirmation: payload.plaintextConfirmation,
        encryptionPassword: payload.encryptionPassword,
      }, BrowserWindow.fromWebContents(event.sender))
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.saveImportTemplate.channel, async (event, rawPayload: unknown) => {
    try {
      vaultIpc.saveImportTemplate.validate(rawPayload)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'Import window is unavailable' }
      const result = await dialog.showSaveDialog(win, {
        title: 'Save Vaultage CSV import template',
        defaultPath: 'vaultage-import-template.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })
      if (result.canceled) return { success: false, cancelled: true }
      await atomicWritePrivateFile(result.filePath!, templateCsv())
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.beginEncryptedImport.channel, async (event, rawPayload: unknown) => {
    const webContentsId = event.sender.id
    const attempt = ++nextEncryptedImportAttempt
    encryptedImportAttemptBySender.set(webContentsId, attempt)
    if (!encryptedImportSenderCleanupRegistered.has(webContentsId)) {
      encryptedImportSenderCleanupRegistered.add(webContentsId)
      const sender = event.sender as typeof event.sender & { once?: (event: string, cb: () => void) => void }
      sender.once?.('destroyed', () => {
        clearEncryptedImportsForSender(webContentsId)
        encryptedImportAttemptBySender.delete(webContentsId)
        encryptedImportSenderCleanupRegistered.delete(webContentsId)
      })
    }
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.beginEncryptedImport.validate(rawPayload)
      const data = validateImportExportText(payload.data)
      const password = validatePasswordInput(payload.password, 'export password')
      operation.assertCurrent()
      const decrypted = await decryptScopedVaultExport(data, password)
      operation.assertCurrent()
      const currentVault = await readVault(vaultKey)
      operation.assertCurrent()
      const revision = vaultRevisionFrom(currentVault, deps.getVaultRevision())
      const preview = buildEncryptedImportPreview(decrypted)
      const token = randomUUID()
      const expiresAtMs = Date.now() + ENCRYPTED_IMPORT_TTL_MS
      if (encryptedImportAttemptBySender.get(webContentsId) !== attempt) {
        preview.selections.clear()
        return {
          success: false,
          stale: true,
          error: 'A newer encrypted import preview superseded this request',
        }
      }
      clearEncryptedImportsForSender(webContentsId)

      const session = {
        token,
        webContentsId,
        sessionEpoch: operation.epoch,
        revision,
        expiresAtMs,
        root: decrypted,
        selections: preview.selections,
        monitor: undefined as unknown as ReturnType<typeof setInterval>,
      } satisfies EncryptedImportSession
      session.monitor = setInterval(() => {
        if (Date.now() >= session.expiresAtMs) {
          clearEncryptedImport(token)
          return
        }
        const current = deps.beginSessionOperation()
        if (!current) {
          clearEncryptedImport(token)
          return
        }
        try {
          if (current.epoch !== session.sessionEpoch) clearEncryptedImport(token)
        } finally {
          current.release()
        }
      }, ENCRYPTED_IMPORT_SESSION_CHECK_MS)
      session.monitor.unref?.()
      encryptedImports.set(token, session)
      return {
        success: true,
        token,
        revision,
        items: preview.items,
        expiresAt: new Date(expiresAtMs).toISOString(),
      }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.cancelEncryptedImport.channel, (event, rawPayload: unknown) => {
    try {
      const payload = vaultIpc.cancelEncryptedImport.validate(rawPayload)
      const session = encryptedImports.get(payload.token)
      if (session?.webContentsId === event.sender.id) clearEncryptedImport(payload.token)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.commitEncryptedImport.channel, async (event, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    let token: string | null = null
    try {
      const payload = vaultIpc.commitEncryptedImport.validate(rawPayload)
      const session = encryptedImports.get(payload.token)
      if (
        !session
        || session.webContentsId !== event.sender.id
        || session.expiresAtMs <= Date.now()
        || session.sessionEpoch !== operation.epoch
        || !session.root
      ) {
        if (session?.webContentsId === event.sender.id) clearEncryptedImport(payload.token)
        return { success: false, sessionExpired: true, error: 'Encrypted import session expired; decrypt the export again' }
      }
      token = payload.token
      if (payload.expectedRevision !== session.revision) {
        return { success: false, stale: true, error: 'Vault changed after the import preview; decrypt the export again' }
      }
      const selectedSecretIds = payload.selectionIds.map(selectionId => {
        const secretId = session.selections.get(selectionId)
        if (!secretId) throw new Error('Encrypted import selection is invalid or expired')
        return secretId
      })
      const command = {
        type: 'folder.import' as const,
        parentId: payload.destinationFolderId,
        folder: session.root.root,
        selectedSecretIds,
      }
      operation.assertCurrent()
      // The token is deliberately one-shot. A failed or stale commit requires
      // a fresh decrypt/preview so retained plaintext cannot be replayed.
      clearEncryptedImport(payload.token)

      const mutationId = randomUUID()
      const commandFingerprint = fingerprintVaultMutationCommand(command)
      const committed = await commitVaultUpdate(vaultKey, async currentVault => {
        operation.assertCurrent()
        const currentRevision = vaultRevisionFrom(currentVault, deps.getVaultRevision())
        if (currentRevision !== payload.expectedRevision) {
          throw new StaleVaultMutationError(
            currentRevision,
            deps.decorateVaultSnapshot(redactVaultForRenderer(currentVault)),
          )
        }
        const providerAuthorizedCommand = deps.authorizeProviderMutation?.(
          currentVault,
          command,
          { sessionEpoch: operation.epoch, webContentsId: event.sender.id },
        ) ?? command
        const commercialAuthorizedCommand = await deps.authorizeCommercialMutation?.(
          currentVault,
          providerAuthorizedCommand,
        ) ?? providerAuthorizedCommand
        const authorizedCommand = await deps.authorizeProjectPathMutation(
          currentVault,
          commercialAuthorizedCommand as VaultMutationCommand,
          { webContentsId: event.sender.id },
        )
        operation.assertCurrent()
        const nextRevision = currentRevision + 1
        const applied = applyVaultMutationCommand(currentVault, authorizedCommand)
        const next = { ...applied.vault, revision: nextRevision }
        const auditEntries = deriveVaultCrudAuditEntries(currentVault, next, nextRevision)
        const received = withVaultMutationReceipt(next, {
          id: mutationId,
          revision: nextRevision,
          commandType: command.type,
          commandFingerprint,
          commandResult: applied.result,
          auditEntries,
        })
        validateVaultRoot(received.vault)
        const changedData = redactVaultForRenderer(received.vault)
        return {
          json: validateVaultSaveJson(JSON.stringify(received.vault)),
          result: {
            revision: nextRevision,
            data: deps.decorateVaultSnapshot(changedData),
            changedData,
            commandResult: applied.result,
            receipt: received.receipt,
          },
        }
      })
      try {
        deps.setVaultRevision(committed.value.revision)
      } catch (err) {
        // The encrypted mutation receipt is already durable. Publication
        // failure must not make a committed import look retryable.
        console.error('[vault] Could not publish encrypted import revision:', err)
      }
      for (const entry of auditEntriesFromVaultMutationReceipt(committed.value.receipt)) {
        try {
          deps.recordAudit(entry.type, entry.details)
        } catch (err) {
          console.error('[vault] Could not enqueue encrypted import audit entry:', err)
        }
      }
      try {
        deps.onVaultChanged?.({
          revision: committed.value.revision,
          data: committed.value.changedData,
          source: 'encrypted-import',
        })
      } catch (err) {
        console.error('[vault] Could not publish encrypted import snapshot:', err)
      }
      const commandResult = committed.value.commandResult as {
        folderId?: unknown
        firstSecretId?: unknown
        secretCount?: unknown
      } | undefined
      return {
        success: true,
        revision: committed.value.revision,
        data: committed.value.data,
        result: committed.value.commandResult,
        folderId: typeof commandResult?.folderId === 'string' ? commandResult.folderId : undefined,
        firstSecretId: typeof commandResult?.firstSecretId === 'string' || commandResult?.firstSecretId === null
          ? commandResult.firstSecretId
          : undefined,
        secretCount: typeof commandResult?.secretCount === 'number' ? commandResult.secretCount : undefined,
      }
    } catch (err) {
      if (err instanceof StaleVaultMutationError) {
        return {
          success: false,
          stale: true,
          error: 'Vault changed while this import was pending. Decrypt the export again.',
          revision: err.currentRevision,
          data: err.currentSnapshot,
        }
      }
      return { success: false, error: String(err) }
    } finally {
      if (token) clearEncryptedImport(token)
      operation.release()
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
  win: BrowserWindow | null,
): Promise<{ success: boolean; cancelled?: boolean; committed?: boolean; path?: string; error?: string }> {
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
    let committed = false
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

    if (!win) return { success: false, error: 'Export window is unavailable' }
    const result = await dialog.showSaveDialog(win, {
      title: `Export ${exportData.scopeLabel}`,
      defaultPath: `${fileStem}.${extension}`,
      filters,
    })
    if (result.canceled) return { success: false, cancelled: true }

    try {
      operation.assertCurrent()
      if (!isEncrypted) {
        await deps.recordAuditDurable('vault.plaintext_release.authorized', {
          action: 'vault-export',
          scopeKind: payload.scope.kind,
          scopeId: 'id' in payload.scope ? payload.scope.id : undefined,
          format: payload.format,
          itemCount: exportData.itemCount,
        })
        operation.assertCurrent()
      }
      await atomicWritePrivateFile(result.filePath!, fileContent, {
        beforeCommit: operation.assertCurrent,
      })
      committed = true
      await deps.recordAuditDurable(isEncrypted ? 'vault.exported_encrypted' : 'vault.exported_plaintext', {
        filePath: result.filePath,
        scopeKind: payload.scope.kind,
        scopeId: 'id' in payload.scope ? payload.scope.id : undefined,
        format: payload.format,
        itemCount: exportData.itemCount,
      })
      return { success: true, path: result.filePath }
    } catch (err) {
      return {
        success: false,
        committed,
        path: committed ? result.filePath : undefined,
        error: committed
          ? `The export was written, but its completion audit could not be recorded; Vaultage has locked for safety: ${String(err)}`
          : String(err),
      }
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

async function decryptScopedVaultExport(text: string, password: string): Promise<Record<string, unknown>> {
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
      return validateVaultImportPayload(decoded, { boundary: 'import' })
    } finally {
      plaintext.fill(0)
    }
  } finally {
    key.fill(0)
  }
}

function buildEncryptedImportPreview(vault: Record<string, unknown>): {
  items: Array<{
    selectionId: string
    name: string
    type: string
    folderPath: string
    hasValue: boolean
  }>
  selections: Map<string, string>
} {
  const root = vault.root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Encrypted export vault root is invalid')
  }
  const items: Array<{
    selectionId: string
    name: string
    type: string
    folderPath: string
    hasValue: boolean
  }> = []
  const selections = new Map<string, string>()
  const pending: Array<{ folder: Record<string, unknown>; path: string[] }> = [{
    folder: root as Record<string, unknown>,
    path: [],
  }]
  while (pending.length > 0) {
    const { folder, path } = pending.pop()!
    const folderName = typeof folder.name === 'string' ? folder.name : 'Imported folder'
    const nextPath = [...path, folderName]
    const secrets = Array.isArray(folder.secrets) ? folder.secrets : []
    for (const candidate of secrets) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const secret = candidate as Record<string, unknown>
      if (typeof secret.id !== 'string' || typeof secret.name !== 'string' || typeof secret.type !== 'string') continue
      const selectionId = randomUUID()
      selections.set(selectionId, secret.id)
      const fields = Array.isArray(secret.fields) ? secret.fields : []
      const hasValue = fields.some(field => Boolean(
        field
        && typeof field === 'object'
        && !Array.isArray(field)
        && typeof (field as Record<string, unknown>).value === 'string'
        && (field as Record<string, unknown>).value !== '',
      )) || (typeof secret.notes === 'string' && secret.notes !== '')
      items.push({
        selectionId,
        name: secret.name,
        type: secret.type,
        folderPath: nextPath.join(' / '),
        hasValue,
      })
    }
    const children = Array.isArray(folder.children) ? folder.children : []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        pending.push({ folder: child as Record<string, unknown>, path: nextPath })
      }
    }
  }
  return { items, selections }
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
