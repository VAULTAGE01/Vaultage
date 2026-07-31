import { describe, expect, it } from 'vitest'
import type { VaultRoot } from '../../types'
import {
  buildVaultSurfaceModel,
  filterVaultSurfaceModel,
  searchVaultSurface,
} from './vaultSurfaceModel.open'

const fixture: VaultRoot = {
  version: 2,
  providers: [],
  envProjects: [],
  root: {
    id: 'root',
    name: 'Vault',
    secrets: [],
    children: [{
      id: 'api',
      name: 'API keys',
      secrets: [{
        id: 'production-key',
        name: 'Production API key',
        type: 'apiKey',
        fields: [],
        notes: '',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
        scope: 'production',
        tags: ['favorite'],
      }, {
        id: 'staging-key',
        name: 'Staging API key',
        type: 'apiKey',
        fields: [],
        notes: '',
        createdAt: '2026-07-03T10:00:00.000Z',
        updatedAt: '2026-07-04T10:00:00.000Z',
        scope: 'staging',
        expiresAt: '2026-07-25T10:00:00.000Z',
      }],
      children: [],
    }],
  },
}

describe('Community Vault UI2026 model', () => {
  it('derives dashboard content from the existing local vault snapshot', () => {
    const model = buildVaultSurfaceModel(
      fixture,
      Date.parse('2026-07-24T12:00:00.000Z'),
    )

    expect(model.totalSecrets).toBe(2)
    expect(model.collectionCount).toBe(1)
    expect(model.environments).toBe(2)
    expect(model.pinnedSecrets.map((secret) => secret.name))
      .toEqual(['Production API key'])
    expect(model.reminders.map((secret) => secret.name))
      .toEqual(['Staging API key'])
    expect(model.collections).toEqual([{
      id: 'api',
      name: 'API keys',
      count: 2,
      pinned: true,
    }])
  })

  it('keeps local scope explicit and filters real values', () => {
    const model = buildVaultSurfaceModel({
      ...fixture,
      root: {
        ...fixture.root,
        secrets: [{
          id: 'local-password',
          name: 'Local password',
          type: 'password',
          fields: [],
          notes: '',
          createdAt: '2026-07-06T10:00:00.000Z',
          updatedAt: '2026-07-06T10:00:00.000Z',
        }],
      },
    })

    expect(model.typeGroups).toContainEqual({
      type: 'password',
      count: 1,
      environments: [{ environment: 'local', count: 1 }],
    })
    expect(filterVaultSurfaceModel(
      buildVaultSurfaceModel(fixture),
      'production',
    ).pinnedSecrets).toHaveLength(1)
  })

  it('searches full hierarchy beyond dashboard result limits', () => {
    const vault: VaultRoot = {
      ...fixture,
      root: {
        ...fixture.root,
        children: Array.from({ length: 6 }, (_, index) => ({
          id: 'folder-' + index,
          name: 'Archive ' + index,
          children: [],
          secrets: [{
            id: 'secret-' + index,
            name: index === 5 ? 'Older recovery token' : 'Recent ' + index,
            type: 'apiKey',
            fields: [],
            notes: '',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: index === 5
              ? '2026-06-01T00:00:00.000Z'
              : '2026-07-0' + (index + 1) + 'T00:00:00.000Z',
          }],
        })),
      },
    }
    const model = buildVaultSurfaceModel(vault)

    expect(model.recentSecrets)
      .not.toContainEqual(expect.objectContaining({ name: 'Older recovery token' }))
    expect(searchVaultSurface(model, 'older recovery'))
      .toContainEqual(expect.objectContaining({
        kind: 'secret',
        name: 'Older recovery token',
      }))
    expect(searchVaultSurface(model, 'archive 5'))
      .toContainEqual(expect.objectContaining({
        kind: 'folder',
        name: 'Archive 5',
      }))
  })
})
