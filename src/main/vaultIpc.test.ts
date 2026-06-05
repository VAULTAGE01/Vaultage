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
  createFromBuffer: vi.fn(),
}))

const storageMock = vi.hoisted(() => ({
  readVault: vi.fn(),
  updateVault: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  clipboard: {
    writeText: electronMock.writeText,
    readText: electronMock.readText,
    writeImage: electronMock.writeImage,
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
}))

import { registerVaultIpc } from './vaultIpc'

describe('registerVaultIpc export IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.readText.mockReturnValue('')
    electronMock.createFromBuffer.mockReturnValue({ isEmpty: () => false })
    storageMock.readVault.mockResolvedValue(sampleVault())
  })

  it('writes encrypted scoped exports and decrypts them through IPC', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const auditEvents: { type: AuditEventType; details?: Record<string, unknown> }[] = []
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: false, error: 'Should not be called' })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController
    const dir = await fs.mkdtemp(join(tmpdir(), 'vaultage-ipc-'))
    const filePath = join(dir, 'api-keys.vaultage-export')
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: (type, details) => auditEvents.push({ type, details }),
    })

    const exportResult = await handlers.get('vault:export-scope')?.({}, {
      scope: { kind: 'folder', id: 'folder-api' },
      format: 'encrypted',
      encryptionPassword: 'correct horse battery staple',
    })

    expect(exportResult).toEqual({ success: true, path: filePath })
    expect(authController.confirmPlaintextExport).not.toHaveBeenCalled()
    expect(electronMock.showSaveDialog).toHaveBeenCalledWith(null, expect.objectContaining({
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

    const decryptResult = await handlers.get('vault:decrypt-export')?.({}, {
      data: rawExport,
      password: 'correct horse battery staple',
    })

    expect(decryptResult).toMatchObject({
      success: true,
      data: {
        format: 'vaultage.export.v1',
        scope: { kind: 'folder', id: 'folder-api' },
        vault: {
          root: {
            id: 'folder-api',
            secrets: [{
              id: 'secret-stripe',
              fields: [{ key: 'API Key', value: 'stripe-secret-value', sensitive: true }],
            }],
          },
        },
      },
    })
  })

  it('requires plaintext confirmation before JSON or CSV export', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const authController = {
      confirmPlaintextExport: vi.fn(() => ({ success: false, error: 'Typed plaintext export confirmation required' })),
      confirmSecretReveal: vi.fn(() => ({ success: true })),
      forgetTouchID: vi.fn(() => ({ success: true })),
    } as unknown as AuthController

    registerVaultIpc(ipcMain, {
      getVaultKey: () => Buffer.alloc(32, 7),
      getVaultRevision: () => 1,
      setVaultRevision: vi.fn(),
      lockVault: vi.fn(),
      authController,
      recordAudit: vi.fn(),
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
