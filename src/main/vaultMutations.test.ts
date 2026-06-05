import { describe, expect, it } from 'vitest'
import { copySecretFieldInVault, revealSecretFieldsInVault, trackSecretUsageInVault } from './vaultMutations'

describe('trackSecretUsageInVault', () => {
  it('updates only the selected secret usage metadata', () => {
    const vault = {
      version: 2,
      root: {
        id: 'root',
        secrets: [{ id: 'a', name: 'A', usageCount: 2 }],
        children: [{
          id: 'child',
          secrets: [{ id: 'b', name: 'B' }],
          children: [],
        }],
      },
    }

    expect(trackSecretUsageInVault(vault, 'b', '2026-05-29T12:00:00.000Z')).toEqual({
      version: 2,
      root: {
        id: 'root',
        secrets: [{ id: 'a', name: 'A', usageCount: 2 }],
        children: [{
          id: 'child',
          secrets: [{
            id: 'b',
            name: 'B',
            usageCount: 1,
            lastUsedAt: '2026-05-29T12:00:00.000Z',
            updatedAt: '2026-05-29T12:00:00.000Z',
          }],
          children: [],
        }],
      },
    })
  })

  it('rejects unknown secret ids', () => {
    expect(() => trackSecretUsageInVault({ root: { secrets: [], children: [] } }, 'missing'))
      .toThrow('Secret not found')
  })

  it('resolves a field value and tracks usage in one vault mutation', () => {
    const result = copySecretFieldInVault({
      version: 2,
      root: {
        id: 'root',
        secrets: [{
          id: 'secret-1',
          name: 'API Key',
          fields: [{ key: 'token', value: 'secret-value' }],
        }],
        children: [],
      },
    }, 'secret-1', 'token', '2026-05-29T12:00:00.000Z')

    expect(result.value).toBe('secret-value')
    expect(result.vault).toMatchObject({
      root: {
        secrets: [{
          id: 'secret-1',
          usageCount: 1,
          lastUsedAt: '2026-05-29T12:00:00.000Z',
          updatedAt: '2026-05-29T12:00:00.000Z',
        }],
      },
    })
  })

  it('reveals all fields for a pinned secret and tracks usage once', () => {
    const result = revealSecretFieldsInVault({
      version: 2,
      root: {
        id: 'root',
        secrets: [{
          id: 'secret-1',
          name: 'API Key',
          fields: [
            { key: 'Service', value: 'Stripe', sensitive: false },
            { key: 'token', value: 'secret-value', sensitive: true },
          ],
        }],
        children: [],
      },
    }, 'secret-1', '2026-05-29T12:00:00.000Z')

    expect(result.fields).toEqual([
      { key: 'Service', value: 'Stripe', sensitive: false },
      { key: 'token', value: 'secret-value', sensitive: true },
    ])
    expect(result.vault).toMatchObject({
      root: {
        secrets: [{
          id: 'secret-1',
          usageCount: 1,
          lastUsedAt: '2026-05-29T12:00:00.000Z',
          updatedAt: '2026-05-29T12:00:00.000Z',
        }],
      },
    })
  })
})
