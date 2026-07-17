import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { AuthController } from './auth'
import type { VaultIpcDeps } from './vaultIpcCommon'

const mocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  createVaultBackupSnapshot: vi.fn(),
  readVaultBackupSnapshot: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}))

vi.mock('./vaultStorage', () => ({
  createVaultBackupSnapshot: mocks.createVaultBackupSnapshot,
  readVaultBackupSnapshot: mocks.readVaultBackupSnapshot,
}))

import { registerVaultSessionIpc } from './vaultSessionIpc'

describe('vault session backup and restore IPC', () => {
  let scratch: string

  beforeEach(async () => {
    vi.clearAllMocks()
    scratch = await fs.mkdtemp(join(tmpdir(), 'vaultage-session-ipc-'))
  })

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
  })

  it('publishes a backup directory only after the queued snapshot succeeds', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const key = Buffer.alloc(32, 4)
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [scratch] })
    mocks.createVaultBackupSnapshot.mockImplementation(async (target: string) => {
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(join(target, 'vaultage-backup.json'), '{}')
    })
    registerVaultSessionIpc(ipcMain, deps({ getVaultKey: () => key }))

    const result = await handlers.get('vault:backup')?.({}, undefined) as {
      success: boolean
      path: string
    }
    expect(result.success).toBe(true)
    expect(result.path).toMatch(/vault-backup-\d{4}-\d{2}-\d{2}T/)
    expect(mocks.createVaultBackupSnapshot).toHaveBeenCalledWith(expect.stringContaining('.tmp'), key)
    await expect(fs.access(result.path)).resolves.toBeUndefined()
  })

  it('removes the staged backup when the vault session changes before publish', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    let current = true
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [scratch] })
    mocks.createVaultBackupSnapshot.mockImplementation(async (target: string) => {
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(join(target, 'vaultage-backup.json'), '{}')
      current = false
    })
    registerVaultSessionIpc(ipcMain, deps({
      beginSessionOperation: () => ({
        epoch: 1,
        assertCurrent: () => { if (!current) throw new Error('Vault session changed') },
        release: () => undefined,
      }),
    }))

    await expect(handlers.get('vault:backup')?.({}, undefined)).resolves.toMatchObject({ success: false })
    await expect(fs.readdir(scratch)).resolves.toEqual([])
  })

  it('validates and commits a restore before locking and requesting restart', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const snapshot = {
      paramsRaw: '{"version":2,"scrypt":{}}',
      wrappedKey: Buffer.alloc(48),
      vaultBlob: Buffer.alloc(64),
    }
    const restoreBackup = vi.fn().mockResolvedValue({ success: true })
    const lockVault = vi.fn().mockResolvedValue(undefined)
    const quitApp = vi.fn()
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [scratch] })
    mocks.readVaultBackupSnapshot.mockResolvedValue(snapshot)
    registerVaultSessionIpc(ipcMain, deps({ restoreBackup, lockVault, quitApp }))

    const result = await handlers.get('vault:restore-backup')?.({}, {
      currentPassword: 'current password',
      backupPassword: 'backup password',
      confirmation: 'RESTORE VAULT',
    })

    expect(result).toEqual({ success: true, path: scratch, restartRequired: true })
    expect(restoreBackup).toHaveBeenCalledWith(snapshot, expect.objectContaining({
      currentPassword: 'current password',
      backupPassword: 'backup password',
    }))
    expect(lockVault).toHaveBeenCalledWith(false, 'backup-restore')
    expect(quitApp).toHaveBeenCalledOnce()
  })

  it('allows the controller to verify and restore while the vault is locked', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const snapshot = {
      paramsRaw: '{"version":2,"scrypt":{}}',
      wrappedKey: Buffer.alloc(48),
      vaultBlob: Buffer.alloc(64),
    }
    const restoreBackup = vi.fn().mockResolvedValue({ success: true })
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [scratch] })
    mocks.readVaultBackupSnapshot.mockResolvedValue(snapshot)
    registerVaultSessionIpc(ipcMain, deps({
      getVaultKey: () => null,
      restoreBackup,
    }))

    await expect(handlers.get('vault:restore-backup')?.({}, {
      currentPassword: 'current password',
      backupPassword: 'backup password',
      confirmation: 'RESTORE VAULT',
    })).resolves.toMatchObject({ success: true, restartRequired: true })
    expect(restoreBackup).toHaveBeenCalledOnce()
  })

  it('rejects restore without explicit confirmation before opening a directory', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultSessionIpc(ipcMain, deps())

    const result = await handlers.get('vault:restore-backup')?.({}, {
      currentPassword: 'current password',
      backupPassword: 'backup password',
      confirmation: 'yes',
    })
    expect(result).toEqual({ success: false, error: 'Type RESTORE VAULT to confirm backup restore' })
    expect(mocks.showOpenDialog).not.toHaveBeenCalled()
  })

  it('signs out on non-macOS when Touch ID is simply unavailable', async () => {
    const { handlers, ipcMain } = fakeIpcMain()
    const lockVault = vi.fn().mockResolvedValue(undefined)
    const quitApp = vi.fn()
    registerVaultSessionIpc(ipcMain, deps({
      forgetTouchID: () => ({ success: false, notFound: true, error: 'Touch ID unavailable' }),
      lockVault,
      quitApp,
    }))

    await expect(handlers.get('vault:sign-out')?.({}, undefined)).resolves.toEqual({ success: true })
    expect(lockVault).toHaveBeenCalledWith(false, 'sign-out')
    expect(quitApp).toHaveBeenCalledOnce()
  })
})

function deps(overrides: {
  getVaultKey?: () => Buffer | null
  restoreBackup?: AuthController['restoreBackup']
  forgetTouchID?: AuthController['forgetTouchID']
  lockVault?: VaultIpcDeps['lockVault']
  quitApp?: () => void
  beginSessionOperation?: VaultIpcDeps['beginSessionOperation']
} = {}): VaultIpcDeps {
  return {
    getVaultKey: overrides.getVaultKey ?? (() => Buffer.alloc(32, 1)),
    readVault: vi.fn(),
    beginSessionOperation: overrides.beginSessionOperation ?? (() => ({
      epoch: 1,
      assertCurrent: () => undefined,
      release: () => undefined,
    })),
    recordSecretUsage: vi.fn(),
    decorateVaultSnapshot: value => value,
    authorizeProjectPathMutation: async (_vault, command) => command,
    getVaultRevision: () => 1,
    setVaultRevision: vi.fn(),
    lockVault: overrides.lockVault ?? vi.fn(),
    authController: {
      forgetTouchID: overrides.forgetTouchID ?? (() => ({ success: true })),
      restoreBackup: overrides.restoreBackup ?? vi.fn(),
    } as unknown as AuthController,
    recordAudit: vi.fn(),
    recordAuditDurable: vi.fn(async () => undefined),
    quitApp: overrides.quitApp,
  }
}

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
