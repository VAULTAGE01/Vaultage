import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultIpcDeps } from './vaultIpcCommon'

const storage = vi.hoisted(() => ({
  createVault: vi.fn(),
  deleteVault: vi.fn(),
  readVaultById: vi.fn(),
  readVaultCollection: vi.fn(),
  renameVault: vi.fn(),
  setVaultArchived: vi.fn(),
  switchActiveVault: vi.fn(),
  StaleVaultCollectionMutationError: class StaleVaultCollectionMutationError extends Error {},
}))

vi.mock('./vaultStorage', () => storage)

import { registerVaultCollectionIpc } from './vaultCollectionIpc'

const key = Buffer.alloc(32, 5)
const activeCollection = {
  revision: 2,
  activeVaultId: 'vault-new',
  vaults: [{
    id: 'vault-new',
    name: 'New vault',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    archived: false,
  }],
}

describe('registerVaultCollectionIpc post-commit safety', () => {
  beforeEach(() => vi.clearAllMocks())

  it('locks instead of returning a success without data after a committed create snapshot read fails', async () => {
    storage.createVault.mockResolvedValue(activeCollection)
    storage.readVaultById.mockRejectedValue(new Error('simulated committed snapshot failure'))
    const lockVault = vi.fn(async () => undefined)
    const onVaultChanged = vi.fn()
    const recordAudit = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultCollectionIpc(ipcMain, deps({ lockVault, onVaultChanged, recordAudit }))

    const result = await handlers.get('vault:create-vault')?.({} as IpcMainInvokeEvent, {
      operationId: 'create-vault-new',
      expectedRevision: 1,
      name: 'New vault',
    })

    expect(result).toEqual({
      success: false,
      error: 'Vault changed but its new snapshot is unavailable. Vaultage was locked for safety.',
    })
    expect(lockVault).toHaveBeenCalledWith(true, 'active-vault-snapshot-unavailable')
    expect(onVaultChanged).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith('vault.collection.created', { vaultId: 'vault-new' })
  })

  it('reaches the durable switch receipt before rejecting a now-missing target, then locks on an unavailable replay snapshot', async () => {
    storage.readVaultCollection.mockResolvedValue({
      revision: 7,
      activeVaultId: 'vault-root',
      vaults: [{
        id: 'vault-root', name: 'Root', createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z', archived: false,
      }],
    })
    storage.switchActiveVault.mockResolvedValue({
      ...activeCollection,
      alreadyCommitted: true,
    })
    storage.readVaultById.mockRejectedValue(new Error('historical target is gone'))
    const lockVault = vi.fn(async () => undefined)
    const beforeVaultScopeChange = vi.fn(async () => undefined)
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultCollectionIpc(ipcMain, deps({ lockVault, beforeVaultScopeChange }))

    const result = await handlers.get('vault:switch-vault')?.({} as IpcMainInvokeEvent, {
      operationId: 'switch-historical-vault',
      expectedRevision: 3,
      vaultId: 'vault-new',
    })

    expect(storage.switchActiveVault).toHaveBeenCalledOnce()
    expect(beforeVaultScopeChange).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false })
    expect(lockVault).toHaveBeenCalledWith(true, 'active-vault-snapshot-unavailable')
  })
})

function fakeIpcMain() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, listener: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, listener)
      },
    } as unknown as IpcMain,
  }
}

function deps(overrides: Partial<VaultIpcDeps> = {}): VaultIpcDeps {
  return {
    getVaultKey: () => key,
    readVault: vi.fn(),
    beginSessionOperation: () => ({ epoch: 1, assertCurrent: vi.fn(), release: vi.fn() }),
    recordSecretUsage: vi.fn(),
    decorateVaultSnapshot: value => value,
    getVaultRevision: () => 1,
    setVaultRevision: vi.fn(),
    authorizeProjectPathMutation: async (_vault, command) => command,
    lockVault: vi.fn(),
    authController: { verifyMasterPassword: vi.fn() } as never,
    recordAudit: vi.fn(),
    recordAuditDurable: vi.fn(),
    ...overrides,
  }
}
