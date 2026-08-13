import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { IpcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEventType } from './audit'
import type { AuthController } from './auth'

const electronMock = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  writeText: vi.fn(),
  readText: vi.fn(),
  writeImage: vi.fn(),
  readImage: vi.fn(),
  clearClipboard: vi.fn(),
  createFromBuffer: vi.fn(),
  window: {},
}))

const storageMock = vi.hoisted(() => ({
  readVault: vi.fn(),
  updateVault: vi.fn(),
  commitVaultUpdate: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null, fromWebContents: () => electronMock.window },
  clipboard: {
    writeText: electronMock.writeText,
    readText: electronMock.readText,
    writeImage: electronMock.writeImage,
    readImage: electronMock.readImage,
    clear: electronMock.clearClipboard,
  },
  dialog: {
    showSaveDialog: electronMock.showSaveDialog,
    showOpenDialog: electronMock.showOpenDialog,
  },
  nativeImage: {
    createFromBuffer: electronMock.createFromBuffer,
  },
}))

vi.mock('./vaultStorage', () => ({
  PARAMS_FILE: '/tmp/params.json',
  VAULT_FILE: '/tmp/vault.enc',
  WRAPPED_KEY_FILE: '/tmp/key.wrapped',
  readVault: storageMock.readVault,
  updateVault: storageMock.updateVault,
  commitVaultUpdate: storageMock.commitVaultUpdate,
}))

import { registerVaultIpc } from './vaultIpc'

describe('registerVaultIpc export IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.readText.mockReturnValue('')
    electronMock.readImage.mockReturnValue({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) })
    electronMock.createFromBuffer.mockImplementation(bytes => ({
      isEmpty: () => false,
      toPNG: () => bytes,
    }))
    storageMock.readVault.mockResolvedValue(sampleVault())
    storageMock.commitVaultUpdate.mockImplementation(async (_key, update) => {
      const prepared = await update(await storageMock.readVault())
      return { value: prepared.result }
    })
  })

  it('rejects malformed certificate preview input without exposing submitted material', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController: {
        confirmSecretReveal: vi.fn(),
        forgetTouchID: vi.fn(),
      } as unknown as AuthController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const submittedMaterial = 'not-a-certificate'
    const result = await handlers.get('vault:preview-certificate-metadata')?.({}, {
      format: 'PEM',
      certificateBase64: Buffer.from(submittedMaterial).toString('base64'),
    })

    expect(result).toMatchObject({ success: false, code: 'invalid_certificate' })
    expect(JSON.stringify(result)).not.toContain(submittedMaterial)
  })

  it('keeps decrypted export values in an opaque main-owned import session', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const auditEvents: { type: AuditEventType; details?: Record<string, unknown> }[] = []
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: false, error: 'Should not be called' })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController
    const dir = await fs.mkdtemp(join(tmpdir(), 'vaultage-ipc-'))
    const filePath = join(dir, 'api-keys.vaultage-export')
    let currentSessionEpoch = 1
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: () => ({
        epoch: currentSessionEpoch,
        assertCurrent: () => undefined,
        release: () => undefined,
      }),
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: (type, details) => auditEvents.push({ type, details }),
      recordAuditDurable: async (type, details) => { auditEvents.push({ type, details }) },
    })

    const sender = { id: 7, once: vi.fn() }
    const event = { sender }
    const exportResult = await handlers.get('vault:export-scope')?.(event, {
      scope: { kind: 'folder', id: 'folder-api' },
      format: 'encrypted',
      encryptionPassword: 'correct horse battery staple',
    })

    expect(exportResult).toEqual({ success: true, path: filePath })
    expect(authController.confirmPlaintextExport).not.toHaveBeenCalled()
    expect(electronMock.showSaveDialog).toHaveBeenCalledWith(electronMock.window, expect.objectContaining({
      defaultPath: 'vaultage-folder-api-keys.vaultage-export',
      filters: [{ name: 'Vaultage Encrypted Export', extensions: ['vaultage-export'] }],
    }))

    const rawExport = await fs.readFile(filePath, 'utf8')
    const encryptedExport = JSON.parse(rawExport) as Record<string, unknown>
    expect(encryptedExport.format).toBe('vaultage.encrypted-export.v1')
    expect(encryptedExport.payload).toEqual(expect.any(String))
    expect(rawExport).not.toContain('stripe-secret-value')
    expect(auditEvents).toMatchObject([{
      type: 'vault.exported_encrypted',
      details: {
        scopeKind: 'folder',
        format: 'encrypted',
        itemCount: 1,
      },
    }])

    const beginResult = await handlers.get('vault:begin-encrypted-import')?.(event, {
      data: rawExport,
      password: 'correct horse battery staple',
    })

    expect(beginResult).toMatchObject({
      success: true,
      token: expect.any(String),
      revision: 1,
      items: [{
        selectionId: expect.any(String),
        name: 'Stripe',
        type: 'apiKey',
        folderPath: 'API Keys',
        hasValue: true,
      }],
    })
    expect(JSON.stringify(beginResult)).not.toContain('stripe-secret-value')
    expect(JSON.stringify(beginResult)).not.toContain('Billing')

    const opaque = beginResult as {
      token: string
      items: Array<{ selectionId: string }>
    }
    const foreignResult = await handlers.get('vault:commit-encrypted-import')?.({
      sender: { id: 99 },
    }, {
      token: opaque.token,
      selectionIds: [opaque.items[0].selectionId],
      destinationFolderId: 'root',
      expectedRevision: 1,
    })
    expect(foreignResult).toMatchObject({ success: false, sessionExpired: true })
    expect(storageMock.commitVaultUpdate).not.toHaveBeenCalled()

    const commitResult = await handlers.get('vault:commit-encrypted-import')?.(event, {
      token: opaque.token,
      selectionIds: [opaque.items[0].selectionId],
      destinationFolderId: 'root',
      expectedRevision: 1,
    })
    expect(commitResult).toMatchObject({ success: true, revision: 2, secretCount: 1 })
    expect(storageMock.commitVaultUpdate).toHaveBeenCalledTimes(1)

    const replayResult = await handlers.get('vault:commit-encrypted-import')?.(event, {
      token: opaque.token,
      selectionIds: [opaque.items[0].selectionId],
      destinationFolderId: 'root',
      expectedRevision: 1,
    })
    expect(replayResult).toMatchObject({ success: false, sessionExpired: true })

    const cancelPreview = await handlers.get('vault:begin-encrypted-import')?.(event, {
      data: rawExport,
      password: 'correct horse battery staple',
    }) as { token: string; items: Array<{ selectionId: string }> }
    expect(await handlers.get('vault:cancel-encrypted-import')?.(event, {
      token: cancelPreview.token,
    })).toEqual({ success: true })
    expect(await handlers.get('vault:commit-encrypted-import')?.(event, {
      token: cancelPreview.token,
      selectionIds: [cancelPreview.items[0].selectionId],
      destinationFolderId: 'root',
      expectedRevision: 1,
    })).toMatchObject({ success: false, sessionExpired: true })

    const priorSessionPreview = await handlers.get('vault:begin-encrypted-import')?.(event, {
      data: rawExport,
      password: 'correct horse battery staple',
    }) as { token: string; items: Array<{ selectionId: string }> }
    currentSessionEpoch = 2
    expect(await handlers.get('vault:commit-encrypted-import')?.(event, {
      token: priorSessionPreview.token,
      selectionIds: [priorSessionPreview.items[0].selectionId],
      destinationFolderId: 'root',
      expectedRevision: 1,
    })).toMatchObject({ success: false, sessionExpired: true })

    for (const hostileKdf of [
      { N: 2 ** 24 },
      { p: 1_000_000 },
      { keylen: 1_000_000 },
      { salt: 'aa'.repeat(129) },
    ]) {
      const hostileExport = {
        ...encryptedExport,
        kdf: { ...(encryptedExport.kdf as Record<string, unknown>), ...hostileKdf },
      }
      const hostileResult = await handlers.get('vault:begin-encrypted-import')?.(event, {
        data: JSON.stringify(hostileExport),
        password: 'correct horse battery staple',
      })
      expect(hostileResult).toMatchObject({ success: false })
      expect(String((hostileResult as { error?: string }).error)).toMatch(/Encrypted export (?:N|p|key length|salt) is invalid/)
    }
  }, 15_000)

  it('keeps a newer encrypted import preview when an older request completes last', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: false, error: 'Should not be called' })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController
    const dir = await fs.mkdtemp(join(tmpdir(), 'vaultage-import-race-'))
    const filePath = join(dir, 'race.vaultage-export')
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const sender = { id: 17, once: vi.fn() }
    const event = { sender }
    await expect(handlers.get('vault:export-scope')?.(event, {
      scope: { kind: 'folder', id: 'folder-api' },
      format: 'encrypted',
      encryptionPassword: 'correct horse battery staple',
    })).resolves.toMatchObject({ success: true, path: filePath })
    const rawExport = await fs.readFile(filePath, 'utf8')

    const firstVaultRead = Promise.withResolvers<ReturnType<typeof sampleVault>>()
    storageMock.readVault.mockReset()
    storageMock.readVault
      .mockImplementationOnce(() => firstVaultRead.promise)
      .mockResolvedValue(sampleVault())

    const olderPending = handlers.get('vault:begin-encrypted-import')?.(event, {
      data: rawExport,
      password: 'correct horse battery staple',
    }) as Promise<Record<string, unknown>>
    await vi.waitFor(() => expect(storageMock.readVault).toHaveBeenCalledTimes(1))

    const newerResult = await handlers.get('vault:begin-encrypted-import')?.(event, {
      data: rawExport,
      password: 'correct horse battery staple',
    }) as {
      success: boolean
      token: string
      revision: number
      items: Array<{ selectionId: string }>
    }
    expect(newerResult).toMatchObject({ success: true, token: expect.any(String) })

    firstVaultRead.resolve(sampleVault())
    await expect(olderPending).resolves.toMatchObject({
      success: false,
      stale: true,
      error: 'A newer encrypted import preview superseded this request',
    })

    await expect(handlers.get('vault:commit-encrypted-import')?.(event, {
      token: newerResult.token,
      selectionIds: [newerResult.items[0].selectionId],
      destinationFolderId: 'root',
      expectedRevision: newerResult.revision,
    })).resolves.toMatchObject({ success: true, revision: 2, secretCount: 1 })
  }, 15_000)

  it('requires plaintext confirmation before JSON or CSV export', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: false, error: 'Typed plaintext export confirmation required' })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const result = await handlers.get('vault:export-scope')?.({}, {
      scope: { kind: 'secret', id: 'secret-stripe' },
      format: 'csv',
    })

    expect(result).toEqual({
      success: false,
      error: 'Typed plaintext export confirmation required',
    })
    expect(storageMock.readVault).not.toHaveBeenCalled()
    expect(electronMock.showSaveDialog).not.toHaveBeenCalled()
  })

  it('saves only the fixed shared CSV template through the invoking window', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const dir = await fs.mkdtemp(join(tmpdir(), 'vaultage-import-template-'))
    const filePath = join(dir, 'template.csv')
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    const authController = {
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController
    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const result = await handlers.get('vault:save-import-template')?.({ sender: { id: 8 } }, undefined)
    expect(result).toEqual({ success: true, path: filePath })
    expect(electronMock.showSaveDialog).toHaveBeenCalledWith(electronMock.window, expect.objectContaining({
      defaultPath: 'vaultage-import-template.csv',
    }))
    const saved = await fs.readFile(filePath, 'utf8')
    expect(saved).toContain('name,type,value,username,url,notes,scope,tags')
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('does not write a prepared plaintext export after the vault locks in the save dialog', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: true })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController
    const dir = await fs.mkdtemp(join(tmpdir(), 'vaultage-export-lock-'))
    const filePath = join(dir, 'must-not-exist.json')
    const dialogResult = Promise.withResolvers<{ canceled: boolean; filePath: string }>()
    electronMock.showSaveDialog.mockReturnValue(dialogResult.promise)
    let sessionCurrent = true

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: () => ({
        epoch: 1,
        assertCurrent: () => {
          if (!sessionCurrent) throw new Error('Vault session changed; unlock and try again')
        },
        release: () => undefined,
      }),
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const pending = handlers.get('vault:export-scope')?.({}, {
      scope: { kind: 'vault' },
      format: 'json',
      plaintextConfirmation: 'EXPORT PLAINTEXT',
    }) as Promise<any>
    await vi.waitFor(() => expect(electronMock.showSaveDialog).toHaveBeenCalled())
    sessionCurrent = false
    dialogResult.resolve({ canceled: false, filePath })

    const result = await pending
    expect(result).toMatchObject({ success: false })
    await expect(fs.access(filePath)).rejects.toThrow()
  })

  it('rejects malformed scoped export payloads before reading the vault', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: true })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const result = await handlers.get('vault:export-scope')?.({}, {
      scope: { kind: 'folder', id: '' },
      format: 'json',
    })

    expect(result).toEqual({ success: false, error: 'Error: Invalid export folder id' })
    expect(storageMock.readVault).not.toHaveBeenCalled()
    expect(electronMock.showSaveDialog).not.toHaveBeenCalled()
  })

  it('copies from a main-only vault read and defers usage persistence', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const recordSecretUsage = vi.fn()
    const authController = {
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage,
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    const result = await handlers.get('vault:copy-secret-field')?.({}, {
      secretId: 'secret-stripe',
      fieldKey: 'API Key',
      confirmationPhrase: 'REVEAL SECRET',
    })

    expect(result).toEqual({ success: true })
    expect(authController.confirmSecretReveal).toHaveBeenCalledWith(
      'Copy saved secret value from Vaultage',
      'REVEAL SECRET',
    )
    expect(electronMock.writeText).toHaveBeenCalledWith('stripe-secret-value')
    expect(recordSecretUsage).toHaveBeenCalledWith('secret-stripe', expect.any(String))
    expect(storageMock.updateVault).not.toHaveBeenCalled()
  })

  it('blocks reveal and copy before plaintext reaches the clipboard when the per-secret policy is off', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const blockedVault = sampleVault()
    const blockedSecret = {
      ...blockedVault.root.children[0]!.secrets[0]!,
      revealAllowed: false,
    }
    blockedVault.root.children[0]!.secrets[0] = blockedSecret
    storageMock.readVault.mockResolvedValue(blockedVault)
    const authController = {
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => undefined),
    })

    await expect(handlers.get('vault:copy-secret-field')?.({}, {
      secretId: 'secret-stripe',
      fieldKey: 'API Key',
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining('disabled for this secret') })
    expect(authController.confirmSecretReveal).not.toHaveBeenCalled()
    expect(electronMock.writeText).not.toHaveBeenCalled()
  })

  it('clears a copied value and reports failure when its audit is not durable', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    electronMock.readText.mockReturnValue('stripe-secret-value')
    const authController = {
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
      recordAuditDurable: vi.fn(async () => { throw new Error('audit storage unavailable') }),
    })

    await expect(handlers.get('vault:copy-secret-field')?.({}, {
      secretId: 'secret-stripe',
      fieldKey: 'API Key',
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining('audit storage unavailable') })
    expect(electronMock.writeText).toHaveBeenNthCalledWith(1, 'stripe-secret-value')
    expect(electronMock.writeText).toHaveBeenNthCalledWith(2, '')
  })

  it('saves a selected image through a private main-owned file boundary', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const dir = await fs.mkdtemp(join(tmpdir(), 'vaultage-image-save-'))
    const filePath = join(dir, 'saved.png')
    const audit = vi.fn()
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    storageMock.readVault.mockResolvedValue(sampleVaultWithImage())
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: true })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      readVault: storageMock.readVault,
      beginSessionOperation: activeSessionOperation,
      recordSecretUsage: vi.fn(),
      decorateVaultSnapshot: value => value,
      authorizeProjectPathMutation: async (_vault, command) => command,
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: audit,
      recordAuditDurable: async (type, details) => { audit(type, details) },
    })

    await expect(handlers.get('vault:save-secret-image-field')?.({ sender: {} }, {
      secretId: 'secret-image',
      fieldKey: '__image__',
      plaintextConfirmation: 'EXPORT PLAINTEXT',
    })).resolves.toEqual({ success: true, path: filePath })
    await expect(fs.readFile(filePath)).resolves.toEqual(samplePngBytes())
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
    expect(audit).toHaveBeenCalledWith('vault.exported_plaintext', expect.objectContaining({
      vaultItemId: 'secret-image',
      format: 'png',
      itemCount: 1,
    }))
  })

  it('expires an owned image clipboard value on the main-owned fixed policy', async () => {
    vi.useFakeTimers()
    try {
      const { handlers, ipcMain } = fakeIpcMain()
      storageMock.readVault.mockResolvedValue(sampleVaultWithImage())
      const clipboardImage = { isEmpty: () => false, toPNG: () => samplePngBytes() }
      electronMock.readImage.mockReturnValue(clipboardImage)
      const authController = {
        confirmSecretReveal: vi.fn(() => ({ success: true })),
        forgetTouchID: vi.fn(() => ({ success: true })),
      } as unknown as AuthController
      registerVaultIpc(ipcMain, {
        getVaultKey: () => Buffer.alloc(32, 7),
        readVault: storageMock.readVault,
        beginSessionOperation: activeSessionOperation,
        recordSecretUsage: vi.fn(),
        decorateVaultSnapshot: value => value,
        authorizeProjectPathMutation: async (_vault, command) => command,
        getVaultRevision: () => 1,
        setVaultRevision: vi.fn(),
        lockVault: vi.fn(),
        authController,
        recordAudit: vi.fn(),
        recordAuditDurable: vi.fn(async () => undefined),
      })

      await expect(handlers.get('vault:copy-secret-image-field')?.({}, {
        secretId: 'secret-image',
        fieldKey: '__image__',
        confirmationPhrase: 'REVEAL SECRET',
      })).resolves.toEqual({ success: true })
      expect(authController.confirmSecretReveal).toHaveBeenCalledWith(
        'Copy saved secret image from Vaultage',
        'REVEAL SECRET',
      )
      expect(electronMock.clearClipboard).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(electronMock.clearClipboard).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

function fakeIpcMain(): {
  handlers: Map<string, (...args: unknown[]) => unknown>
  ipcMain: IpcMain
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      },
    } as unknown as IpcMain,
  }
}

function activeSessionOperation() {
  return {
    epoch: 1,
    assertCurrent: () => undefined,
    release: () => undefined,
  }
}

function sampleVault() {
  return {
    version: 2,
    revision: 1,
    root: {
      id: 'root',
      name: 'My Vault',
      children: [{
        id: 'folder-api',
        name: 'API Keys',
        children: [],
        secrets: [{
          id: 'secret-stripe',
          name: 'Stripe',
          type: 'apiKey',
          fields: [{ key: 'API Key', value: 'stripe-secret-value', sensitive: true }],
          notes: 'Billing',
          createdAt: '2026-05-31T12:00:00.000Z',
          updatedAt: '2026-05-31T12:00:00.000Z',
        }],
        itemOrder: [{ kind: 'secret', id: 'secret-stripe' }],
      }],
      secrets: [],
      itemOrder: [{ kind: 'folder', id: 'folder-api' }],
    },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function sampleVaultWithImage() {
  const base = sampleVault()
  base.root.children[0].secrets.push({
    id: 'secret-image',
    name: 'Recovery image',
    type: 'image',
    fields: [{ key: '__image__', value: `data:image/png;base64,${samplePngBytes().toString('base64')}`, sensitive: true }],
    notes: '',
    createdAt: '2026-05-31T12:00:00.000Z',
    updatedAt: '2026-05-31T12:00:00.000Z',
  })
  return base
}

function samplePngBytes(): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(1, 16)
  bytes.writeUInt32BE(1, 20)
  return bytes
}
