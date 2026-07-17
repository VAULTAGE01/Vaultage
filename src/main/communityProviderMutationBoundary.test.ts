import { describe, expect, it } from 'vitest'
import { registerProviderIpc } from './providerIpc.disabled'

describe('Community provider mutation boundary', () => {
  const runtime = registerProviderIpc({} as never, undefined, () => undefined, undefined)
  const context = { sessionEpoch: 1, webContentsId: 1 }

  it.each([
    'secret.provider-link.set',
    'provider.create',
    'provider.update',
    'provider.update-with-secret',
    'provider.delete',
    'provider.move',
    'provider-group.create',
    'provider-group.rename',
    'provider-group.delete',
  ])('rejects closed mutation %s before the shared vault command engine', (type) => {
    expect(() => runtime.authorizeVerificationMutation({}, { type }, context))
      .toThrow('Provider integrations are unavailable in this edition')
  })

  it.each([
    {
      type: 'secret.update',
      secret: { providerLink: { providerId: 'provider-a' } },
    },
    {
      type: 'secret.create-many',
      secrets: [{ providerLink: { providerId: 'provider-a' } }],
    },
    {
      type: 'env-project.update',
      project: { environments: [{ kind: 'cloud', providerId: 'provider-a' }] },
    },
    {
      type: 'preferences.patch',
      patch: { providerVotes: { github: { providerId: 'github' } } },
    },
  ])('rejects provider-owned metadata nested inside $type', (command) => {
    expect(() => runtime.authorizeVerificationMutation({}, command, context))
      .toThrow('Provider-owned metadata cannot be changed in this edition')
  })

  it('strips closed provider and cloud metadata from portable folder imports', () => {
    const command = {
      type: 'folder.import',
      parentId: 'root',
      folder: {
        id: 'portable-folder',
        name: 'Portable folder',
        secrets: [{
          id: 'portable-secret',
          name: 'Portable secret',
          providerLink: { providerId: 'provider-a', remoteName: 'TOKEN' },
        }],
        children: [{
          id: 'nested-folder',
          name: 'Nested folder',
          secrets: [],
          children: [],
          environments: [
            { id: 'local', kind: 'local', path: '/tmp/project', syncRule: 'manual' },
            { id: 'remote', kind: 'cloud', providerId: 'provider-a', providerEnvName: 'Production' },
          ],
        }],
      },
    }

    const authorized = runtime.authorizeVerificationMutation({}, command, context)

    expect(authorized).toEqual({
      type: 'folder.import',
      parentId: 'root',
      folder: {
        id: 'portable-folder',
        name: 'Portable folder',
        secrets: [{ id: 'portable-secret', name: 'Portable secret' }],
        children: [{
          id: 'nested-folder',
          name: 'Nested folder',
          secrets: [],
          children: [],
          environments: [{ id: 'local', kind: 'local', path: '/tmp/project' }],
        }],
      },
    })
    expect(command.folder.secrets[0].providerLink.providerId).toBe('provider-a')
    expect(command.folder.children[0].environments[1]).toMatchObject({
      kind: 'cloud',
      providerId: 'provider-a',
    })
  })

  it.each([
    { type: 'folder.create' },
    { type: 'secret.update', secret: { name: 'Local secret' } },
    {
      type: 'env-project.update',
      project: {
        environments: [{
          id: 'local',
          kind: 'local',
          path: '/tmp/project/.env',
          lastSyncAt: '2026-07-17T00:00:00.000Z',
        }],
      },
    },
  ])('preserves Community Vault/Project mutation $type', (command) => {
    expect(runtime.authorizeVerificationMutation({}, command, context)).toBe(command)
  })
})
