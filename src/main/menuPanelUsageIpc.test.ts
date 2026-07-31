import type { IpcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthController } from './auth'
import type { MenuPanelIpcDeps } from './menuPanelIpc'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  readText: vi.fn(),
  updateVault: vi.fn(),
}))

vi.mock('electron', () => ({
  clipboard: { writeText: mocks.writeText, readText: mocks.readText },
}))
vi.mock('./vaultStorage', () => ({ updateVault: mocks.updateVault }))

import { registerMenuPanelIpc } from './menuPanelIpc'

describe('menu panel usage batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readText.mockReturnValue('')
  })

  it('resolves copy and reveal values in main while deferring usage writes', async () => {
    const recordSecretUsage = vi.fn()
    const readVault = vi.fn().mockResolvedValue(sampleVault())
    const { ipcMain, handlers } = fakeIpcMain()
    registerMenuPanelIpc(ipcMain, deps({ readVault, recordSecretUsage }))

    const copied = await handlers.get('menu-panel:copy')?.({}, {
      secretId: 'secret-a',
      fieldKey: 'token',
      clearAfterMs: 0,
      confirmationPhrase: 'REVEAL SECRET',
    })
    const revealed = await handlers.get('menu-panel:reveal')?.({}, {
      secretId: 'secret-a',
      fieldKey: 'token',
      confirmationPhrase: 'REVEAL SECRET',
    })

    expect(copied).toEqual({ success: true })
    expect(revealed).toEqual({ success: true, value: 'main-only-secret-value' })
    expect(mocks.writeText).toHaveBeenCalledWith('main-only-secret-value')
    expect(readVault).toHaveBeenCalledTimes(2)
    expect(recordSecretUsage).toHaveBeenCalledTimes(2)
    expect(mocks.updateVault).not.toHaveBeenCalled()
  })

  it('keeps closed Free Agent controls available while retaining extension gating', async () => {
    const startAgent = vi.fn()
    const stopAgent = vi.fn()
    const copyAgentInstructions = vi.fn()
    const { ipcMain, handlers } = fakeIpcMain()
    registerMenuPanelIpc(ipcMain, deps({
      isAgentListening: () => true,
      hasBrowserCapability: () => false,
      startAgent,
      stopAgent,
      copyAgentInstructions,
    }))

    await expect(handlers.get('menu-panel:status')?.({}, undefined)).resolves.toMatchObject({
      success: true,
      agentAvailable: true,
      agentListening: true,
      browserAvailable: false,
      browserEnabled: false,
    })
    await expect(handlers.get('menu-panel:action')?.({}, { action: 'startAgent' }))
      .resolves.toEqual({ success: true })
    await expect(handlers.get('menu-panel:action')?.({}, { action: 'copyAgentInstructions' }))
      .resolves.toEqual({ success: true })
    await expect(handlers.get('menu-panel:action')?.({}, { action: 'stopAgent' })).resolves.toEqual({ success: true })
    expect(startAgent).toHaveBeenCalledOnce()
    expect(copyAgentInstructions).toHaveBeenCalledOnce()
    expect(stopAgent).toHaveBeenCalledOnce()
  })

  it('keeps Agent controls excluded from Community builds', async () => {
    const startAgent = vi.fn()
    const { ipcMain, handlers } = fakeIpcMain()
    registerMenuPanelIpc(ipcMain, deps({ openCoreBuild: true, startAgent }))

    await expect(handlers.get('menu-panel:status')?.({}, undefined)).resolves.toMatchObject({
      agentAvailable: false,
      openCoreBuild: true,
    })
    await expect(handlers.get('menu-panel:action')?.({}, { action: 'startAgent' }))
      .resolves.toMatchObject({ success: false })
    expect(startAgent).not.toHaveBeenCalled()
  })

  it('clears copied plaintext and fails when menu-bar audit evidence is not durable', async () => {
    mocks.readText.mockReturnValue('main-only-secret-value')
    const { ipcMain, handlers } = fakeIpcMain()
    registerMenuPanelIpc(ipcMain, deps({
      readVault: vi.fn().mockResolvedValue(sampleVault()),
      recordAuditDurable: vi.fn(async () => { throw new Error('audit storage unavailable') }),
    }))

    await expect(handlers.get('menu-panel:copy')?.({}, {
      secretId: 'secret-a',
      fieldKey: 'token',
      confirmationPhrase: 'REVEAL SECRET',
    })).resolves.toMatchObject({ success: false, error: 'audit storage unavailable' })
    expect(mocks.writeText).toHaveBeenNthCalledWith(1, 'main-only-secret-value')
    expect(mocks.writeText).toHaveBeenNthCalledWith(2, '')
  })
})

function deps(overrides: Partial<MenuPanelIpcDeps> = {}): MenuPanelIpcDeps {
  return {
    appName: 'Vaultage',
    openCoreBuild: false,
    getVaultKey: () => Buffer.alloc(32, 7),
    beginSessionOperation: () => ({ epoch: 1, assertCurrent: () => undefined, release: () => undefined }),
    recordSecretUsage: vi.fn(),
    getVaultRevision: () => 1,
    setVaultRevision: vi.fn(),
    notifyVaultChanged: vi.fn(),
    readVault: vi.fn(),
    pendingCount: () => 0,
    isAgentListening: () => false,
    agentPort: () => 32123,
    isBrowserEnabled: () => false,
    hasBrowserCapability: () => true,
    showMainWindow: vi.fn(),
    navigateMainWindow: vi.fn(),
    closePanel: vi.fn(),
    lockVault: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    startBrowser: vi.fn(),
    stopBrowser: vi.fn(),
    copyAgentInstructions: vi.fn(),
    quitApp: vi.fn(),
    authController: {
      confirmSecretReveal: vi.fn(() => ({ success: true })),
    } as unknown as AuthController,
    recordAudit: vi.fn(),
    recordAuditDurable: vi.fn(async () => undefined),
    ...overrides,
  }
}

function fakeIpcMain(): {
  handlers: Map<string, (...args: any[]) => any>
  ipcMain: IpcMain
} {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    } as unknown as IpcMain,
  }
}

function sampleVault() {
  return {
    version: 2,
    revision: 1,
    root: {
      id: 'root',
      name: 'Vault',
      children: [],
      secrets: [{
        id: 'secret-a',
        name: 'Secret A',
        type: 'apiKey',
        fields: [{ key: 'token', value: 'main-only-secret-value', sensitive: true }],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      itemOrder: [{ kind: 'secret', id: 'secret-a' }],
    },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}
