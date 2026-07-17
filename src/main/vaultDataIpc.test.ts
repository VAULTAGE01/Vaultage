import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthController } from './auth'
import type { VaultIpcDeps } from './vaultIpcCommon'

const storage = vi.hoisted(() => ({ commitVaultUpdate: vi.fn() }))
vi.mock('./vaultStorage', () => ({ commitVaultUpdate: storage.commitVaultUpdate }))

import { registerVaultDataIpc } from './vaultDataIpc'
import { createAuthorizedIpcMain } from './ipcAuthorization'
import { registerProviderIpc } from './providerIpc.disabled'

describe('registerVaultDataIpc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves main-owned usage metadata and emits value-free semantic audit entries', async () => {
    const current = sampleVault()
    let persisted: Record<string, any> | null = null
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(current)
      persisted = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const recordAudit = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({ recordAudit }))

    const candidate = structuredClone(current.root.secrets[0])
    candidate.fields[0].value = 'replacement-value-must-not-be-audited'
    candidate.notes = 'replacement note must not be audited'
    candidate.usageCount = 999
    candidate.lastUsedAt = '2099-01-01T00:00:00.000Z'
    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'mutation-update-secret',
      expectedRevision: 4,
      command: { type: 'secret.update', folderId: 'root', secret: candidate },
    }) as any

    expect(result).toMatchObject({ success: true, revision: 5 })
    expect(persisted!.root.secrets[0]).toMatchObject({
      usageCount: 2,
      lastUsedAt: '2026-01-01T01:00:00.000Z',
    })
    expect(recordAudit).toHaveBeenCalledWith('vault.secret.updated', expect.objectContaining({
      revision: 5,
      mutationId: 'mutation-update-secret',
      vaultItemIds: ['secret-a'],
    }))
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain('replacement-value')
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain('replacement note')
  })

  it('queues high-frequency usage without rewriting the encrypted vault', async () => {
    const recordSecretUsage = vi.fn()
    const operation = {
      epoch: 1,
      assertCurrent: vi.fn(),
      release: vi.fn(),
    }
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      recordSecretUsage,
      beginSessionOperation: () => operation,
    }))

    const result = await handlers.get('vault:track-usage')?.({}, { secretId: 'secret-a' })

    expect(result).toEqual({ success: true })
    expect(recordSecretUsage).toHaveBeenCalledWith('secret-a')
    expect(storage.commitVaultUpdate).not.toHaveBeenCalled()
    expect(operation.assertCurrent).toHaveBeenCalledOnce()
    expect(operation.release).toHaveBeenCalledOnce()
  })

  it('rebases a semantic command only across a proven contiguous usage-only revision range', async () => {
    const current = sampleVault()
    current.revision = 5
    current.root.secrets[0].usageCount = 3
    current._vaultage = {
      recentUsageBatches: [{ id: '00000000-0000-4000-8000-000000000001', revision: 5 }],
    }
    let persisted: any
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(current)
      persisted = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({ getVaultRevision: () => 5 }))
    const candidate = structuredClone(current.root.secrets[0])
    candidate.name = 'Renamed safely'

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'mutation-usage-rebase',
      expectedRevision: 4,
      command: { type: 'secret.update', folderId: 'root', secret: candidate },
    }) as any

    expect(result).toMatchObject({ success: true, revision: 6 })
    expect(persisted.root.secrets[0]).toMatchObject({ name: 'Renamed safely', usageCount: 3 })
    expect(persisted._vaultage.recentUsageBatches).toEqual(current._vaultage.recentUsageBatches)
    expect(persisted._vaultage.recentMutationReceipts).toHaveLength(1)
  })

  it('rejects renderer-forged command properties at the contract boundary before stale handling', async () => {
    const current = sampleVault()
    current.revision = 5
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => ({
      status: 'committed',
      value: (await updater(current)).result,
    }))
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({ getVaultRevision: () => 5 }))
    const candidate = structuredClone(current.root.secrets[0])
    candidate.name = 'Must not save'
    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'mutation-forged-property',
      expectedRevision: 4,
      command: {
        type: 'secret.update',
        folderId: 'root',
        secret: candidate,
        _vaultage: { recentUsageBatches: [{ revision: 5 }] },
      },
    }) as any

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('unsupported property _vaultage'),
    })
    expect(result).not.toHaveProperty('stale')
    expect(storage.commitVaultUpdate).not.toHaveBeenCalled()
  })

  it('routes provider lifecycle metadata through the main authorization hook with session and sender binding', async () => {
    const current = sampleVault()
    let persisted: any
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(current)
      persisted = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const authorizeProviderMutation = vi.fn((_vault, command: Record<string, any>) => {
      const { verificationGrant: _grant, ...rest } = command
      const { lastTestedAt: _forgedTime, ...provider } = command.provider
      return {
        ...rest,
        provider: { ...provider, connectionStatus: 'configured' },
      }
    })
    const operation = { epoch: 19, assertCurrent: vi.fn(), release: vi.fn() }
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      authorizeProviderMutation,
      beginSessionOperation: () => operation,
    }))

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 73 } }, {
      mutationId: 'provider-forged-lifecycle',
      expectedRevision: 4,
      command: {
        type: 'provider.create',
        provider: {
          id: 'provider-new',
          name: 'GitHub',
          type: 'github',
          config: { token: 'credential', repository: 'vaultage/app' },
          connectionStatus: 'verified',
          lastTestedAt: '2099-01-01T00:00:00.000Z',
        },
        verificationGrant: 'g'.repeat(43),
      },
    }) as any

    expect(result).toMatchObject({ success: true, revision: 5 })
    expect(authorizeProviderMutation).toHaveBeenCalledWith(
      current,
      expect.objectContaining({ type: 'provider.create', verificationGrant: 'g'.repeat(43) }),
      { sessionEpoch: 19, webContentsId: 73 },
    )
    expect(persisted.providers[0]).toMatchObject({ connectionStatus: 'configured' })
    expect(persisted.providers[0]).not.toHaveProperty('lastTestedAt')
    expect(JSON.stringify(persisted)).not.toContain('g'.repeat(43))
    expect(operation.release).toHaveBeenCalledOnce()
  })

  it('rejects closed provider mutations before Community storage, audit, or notification', async () => {
    let persisted = false
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(sampleVault())
      persisted = true
      return { status: 'committed', value: output.result }
    })
    const recordAudit = vi.fn()
    const onVaultChanged = vi.fn()
    const providerRuntime = registerProviderIpc({} as IpcMain, undefined, recordAudit, undefined)
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      recordAudit,
      onVaultChanged,
      authorizeProviderMutation: providerRuntime.authorizeVerificationMutation,
    }))

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'community-provider-delete-denied',
      expectedRevision: 4,
      command: { type: 'provider.delete', providerId: 'provider-a' },
    }) as any

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Provider integrations are unavailable in this edition'),
    })
    expect(storage.commitVaultUpdate).toHaveBeenCalledOnce()
    expect(persisted).toBe(false)
    expect(recordAudit).not.toHaveBeenCalled()
    expect(onVaultChanged).not.toHaveBeenCalled()
  })

  it('rejects nested provider metadata before Community persistence or publication', async () => {
    let persisted = false
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(sampleVault())
      persisted = true
      return { status: 'committed', value: output.result }
    })
    const recordAudit = vi.fn()
    const onVaultChanged = vi.fn()
    const providerRuntime = registerProviderIpc({} as IpcMain, undefined, recordAudit, undefined)
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      recordAudit,
      onVaultChanged,
      authorizeProviderMutation: providerRuntime.authorizeVerificationMutation,
    }))
    const secret = structuredClone(sampleVault().root.secrets[0])
    secret.providerLink = {
      providerId: 'provider-a',
      remoteName: 'TOKEN',
      createdInVaultage: false,
      status: 'active',
    }

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'community-nested-provider-link-denied',
      expectedRevision: 4,
      command: { type: 'secret.update', folderId: 'root', secret },
    }) as any

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Provider-owned metadata cannot be changed in this edition'),
    })
    expect(storage.commitVaultUpdate).toHaveBeenCalledOnce()
    expect(persisted).toBe(false)
    expect(recordAudit).not.toHaveBeenCalled()
    expect(onVaultChanged).not.toHaveBeenCalled()
  })

  it('imports private linked secrets into Community as local-only records', async () => {
    const current = sampleVault()
    let persisted: any
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(current)
      persisted = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const providerRuntime = registerProviderIpc({} as IpcMain, undefined, () => undefined, undefined)
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      authorizeProviderMutation: providerRuntime.authorizeVerificationMutation,
    }))
    const importedAt = '2026-07-17T12:00:00.000Z'
    const sourceSecret = {
      id: 'private-secret',
      name: 'Imported API token',
      type: 'apiKey',
      fields: [{ id: 'private-field', key: 'TOKEN', value: 'portable-value', sensitive: true }],
      notes: 'Keep this local note',
      createdAt: importedAt,
      updatedAt: importedAt,
      providerLink: {
        providerId: 'provider-private',
        remoteName: 'Production token',
        createdInVaultage: true,
        status: 'active',
      },
    }

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'community-import-private-export',
      expectedRevision: 4,
      command: {
        type: 'folder.import',
        parentId: 'root',
        folder: {
          id: 'private-export',
          name: 'Private export',
          children: [],
          secrets: [sourceSecret],
          itemOrder: [{ kind: 'secret', id: sourceSecret.id }],
        },
      },
    }) as any

    expect(result).toMatchObject({ success: true, revision: 5 })
    const importedFolder = persisted.root.children[0]
    expect(importedFolder).toMatchObject({ name: 'Private export' })
    expect(importedFolder.secrets[0]).toMatchObject({
      name: 'Imported API token',
      notes: 'Keep this local note',
      fields: [{ key: 'TOKEN', value: 'portable-value', sensitive: true }],
    })
    expect(importedFolder.secrets[0]).not.toHaveProperty('providerLink')
    expect(JSON.stringify(persisted)).not.toContain('provider-private')
  })

  it('imports only selected local records when an unselected private provider link is present', async () => {
    const current = sampleVault()
    let persisted: any
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(current)
      persisted = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const providerRuntime = registerProviderIpc({} as IpcMain, undefined, () => undefined, undefined)
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      authorizeProviderMutation: providerRuntime.authorizeVerificationMutation,
    }))
    const timestamp = '2026-07-17T12:00:00.000Z'
    const localSecret = {
      id: 'selected-local', name: 'Selected local secret', type: 'apiKey',
      fields: [{ id: 'local-field', key: 'TOKEN', value: 'selected-value', sensitive: true }],
      notes: '',
      createdAt: timestamp, updatedAt: timestamp,
    }
    const linkedSecret = {
      ...localSecret,
      id: 'unselected-linked',
      name: 'Unselected linked secret',
      providerLink: {
        providerId: 'provider-private', remoteName: 'Remote token',
        createdInVaultage: true, status: 'active',
      },
    }

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      mutationId: 'community-import-selected-private-export',
      expectedRevision: 4,
      command: {
        type: 'folder.import',
        parentId: 'root',
        selectedSecretIds: [localSecret.id],
        folder: {
          id: 'private-export', name: 'Private export', children: [],
          secrets: [localSecret, linkedSecret],
          itemOrder: [
            { kind: 'secret', id: localSecret.id },
            { kind: 'secret', id: linkedSecret.id },
          ],
        },
      },
    }) as any

    expect(result).toMatchObject({ success: true, revision: 5 })
    expect(persisted.root.children[0].secrets).toHaveLength(1)
    expect(persisted.root.children[0].secrets[0]).toMatchObject({
      name: 'Selected local secret',
      fields: [{ key: 'TOKEN', value: 'selected-value', sensitive: true }],
    })
    expect(JSON.stringify(persisted)).not.toContain('provider-private')
    expect(JSON.stringify(persisted)).not.toContain('Unselected linked secret')
  })

  it('checks stale form revisions before consuming a provider verification grant', async () => {
    const current = sampleVault()
    current.revision = 5
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => ({
      status: 'committed',
      value: (await updater(current)).result,
    }))
    const authorizeProviderMutation = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      getVaultRevision: () => 5,
      authorizeProviderMutation,
    }))

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 73 } }, {
      mutationId: 'stale-provider-editor',
      expectedRevision: 4,
      command: {
        type: 'provider.create',
        provider: {
          id: 'provider-new', name: 'GitHub', type: 'github', config: { token: 'credential' },
        },
        verificationGrant: 'g'.repeat(43),
      },
    }) as any

    expect(result).toMatchObject({ success: false, stale: true, revision: 5 })
    expect(authorizeProviderMutation).not.toHaveBeenCalled()
  })

  it('enforces the commercial project policy inside the serialized authoritative mutation', async () => {
    const current = sampleVault()
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => ({
      status: 'committed',
      value: (await updater(current)).result,
    }))
    const authorizeCommercialMutation = vi.fn(async () => {
      throw new Error('This project is read-only on the Free plan')
    })
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({ authorizeCommercialMutation }))

    const result = await handlers.get('vault:mutate')?.({ sender: { id: 73 } }, {
      mutationId: 'commercial-project-denied',
      expectedRevision: 4,
      command: {
        type: 'env-project.update',
        project: { id: 'project-c', name: 'C', path: '/c', entries: [], addToGitignore: true },
      },
    }) as any

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('read-only on the Free plan') })
    expect(authorizeCommercialMutation).toHaveBeenCalledWith(current, expect.objectContaining({
      type: 'env-project.update',
    }))
  })

  it('rejects an unauthorized renderer before commercial project authorization or storage', async () => {
    const authorizeCommercialMutation = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    const expected = testWebContents(7)
    registerVaultDataIpc(
      createAuthorizedIpcMain(ipcMain, () => expected, 'main-window'),
      deps({ authorizeCommercialMutation }),
    )

    await expect(handlers.get('vault:mutate')?.({
      sender: testWebContents(8),
      senderFrame: expected.mainFrame,
    } as IpcMainInvokeEvent, {
      mutationId: 'unauthorized-project-activation',
      expectedRevision: 4,
      command: {
        type: 'env-project.activate', projectId: 'project-c', replaceProjectId: 'project-a',
      },
    })).rejects.toThrow('not authorized')
    expect(authorizeCommercialMutation).not.toHaveBeenCalled()
    expect(storage.commitVaultUpdate).not.toHaveBeenCalled()
  })

  it('retries a committed mutation idempotently without advancing, re-auditing, or re-notifying', async () => {
    let durable = sampleVault()
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(durable)
      durable = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const recordAudit = vi.fn()
    const setVaultRevision = vi.fn()
    const onVaultChanged = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({ recordAudit, setVaultRevision, onVaultChanged }))
    const payload = {
      mutationId: 'opaque-retry-id',
      expectedRevision: 4,
      command: { type: 'folder.rename', folderId: 'root', name: 'Renamed once' },
    }

    const first = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, payload) as any
    const retry = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, payload) as any

    expect(first).toMatchObject({ success: true, revision: 5 })
    expect(retry).toMatchObject({ success: true, revision: 5 })
    expect(first.data).not.toHaveProperty('_vaultage')
    expect(retry.data).not.toHaveProperty('_vaultage')
    expect(durable.revision).toBe(5)
    expect(durable.root.name).toBe('Renamed once')
    expect((durable._vaultage.recentMutationReceipts as unknown[])).toHaveLength(1)
    expect(recordAudit).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith('vault.folder.updated', expect.objectContaining({
      revision: 5,
      mutationId: 'opaque-retry-id',
      vaultItemIds: ['root'],
    }))
    expect(onVaultChanged).toHaveBeenCalledTimes(1)
    expect(onVaultChanged).toHaveBeenCalledWith(expect.objectContaining({ revision: 5 }))
    expect(setVaultRevision).toHaveBeenNthCalledWith(1, 5)
    expect(setVaultRevision).toHaveBeenNthCalledWith(2, 5)
  })

  it('returns the current snapshot for an older receipt retry and rejects mutation-id command reuse', async () => {
    let durable = sampleVault()
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(durable)
      durable = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const recordAudit = vi.fn()
    const onVaultChanged = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({ recordAudit, onVaultChanged }))
    const firstPayload = {
      mutationId: 'bound-command-id',
      expectedRevision: 4,
      command: { type: 'folder.rename', folderId: 'root', name: 'First name' },
    }
    await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, firstPayload)
    recordAudit.mockClear()
    onVaultChanged.mockClear()
    durable = { ...durable, revision: 6, root: { ...durable.root, name: 'Newer name' } }

    const retry = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, firstPayload) as any
    const collision = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
      ...firstPayload,
      command: { type: 'folder.rename', folderId: 'root', name: 'Different command' },
    }) as any

    expect(retry).toMatchObject({
      success: true,
      revision: 6,
      data: { revision: 6, root: { name: 'Newer name' } },
    })
    expect(recordAudit).not.toHaveBeenCalled()
    expect(onVaultChanged).not.toHaveBeenCalled()
    expect(collision).toMatchObject({
      success: false,
      error: expect.stringContaining('already used for a different command'),
    })
    expect(durable.revision).toBe(6)
    expect(durable.root.name).toBe('Newer name')
  })

  it('never reports a durable commit as failed when revision, audit, or notification publication throws', async () => {
    let durable = sampleVault()
    storage.commitVaultUpdate.mockImplementation(async (_key, updater) => {
      const output = await updater(durable)
      durable = JSON.parse(output.json)
      return { status: 'committed', value: output.result }
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { handlers, ipcMain } = fakeIpcMain()
    registerVaultDataIpc(ipcMain, deps({
      setVaultRevision: () => { throw new Error('revision publication failed') },
      recordAudit: () => { throw new Error('audit publication failed') },
      onVaultChanged: () => { throw new Error('snapshot publication failed') },
    }))

    try {
      const result = await handlers.get('vault:mutate')?.({ sender: { id: 1 } }, {
        mutationId: 'post-commit-publication-failure',
        expectedRevision: 4,
        command: { type: 'folder.rename', folderId: 'root', name: 'Durably renamed' },
      }) as any

      expect(result).toMatchObject({ success: true, revision: 5 })
      expect(durable).toMatchObject({ revision: 5, root: { name: 'Durably renamed' } })
      expect(durable._vaultage.recentMutationReceipts).toHaveLength(1)
      expect(consoleError).toHaveBeenCalledTimes(3)
    } finally {
      consoleError.mockRestore()
    }
  })
})

function deps(overrides: Partial<VaultIpcDeps> = {}): VaultIpcDeps {
  return {
    getVaultKey: () => Buffer.alloc(32, 7),
    readVault: vi.fn(),
    beginSessionOperation: () => ({ epoch: 1, assertCurrent: () => undefined, release: () => undefined }),
    recordSecretUsage: vi.fn(),
    decorateVaultSnapshot: value => value,
    authorizeProjectPathMutation: async (_vault, command) => command,
    getVaultRevision: () => 4,
    setVaultRevision: vi.fn(),
    lockVault: vi.fn(),
    authController: {} as AuthController,
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

function sampleVault(): any {
  return {
    version: 2,
    revision: 4,
    root: {
      id: 'root',
      name: 'Vault',
      children: [],
      secrets: [{
        id: 'secret-a',
        name: 'Secret A',
        type: 'apiKey',
        fields: [{ id: 'field-token', key: 'token', value: 'original-value', sensitive: true }],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        usageCount: 2,
        lastUsedAt: '2026-01-01T01:00:00.000Z',
      }],
      itemOrder: [{ kind: 'secret', id: 'secret-a' }],
    },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function testWebContents(id: number): WebContents {
  const mainFrame = { routingId: id }
  return { id, mainFrame, isDestroyed: () => false } as unknown as WebContents
}
