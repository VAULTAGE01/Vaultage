import { describe, expect, it } from 'vitest'
import {
  copySecretFieldInVault,
  resolveSecretFieldInVault,
  resolveSecretFieldsInVault,
  revealSecretFieldsInVault,
  trackSecretUsageBatchInVault,
  trackSecretUsageInVault,
} from './vaultMutations'
import { legacySecretFieldId } from './vaultRedaction'

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
      {
        id: legacySecretFieldId('secret-1', 'Service', 0),
        key: 'Service',
        value: 'Stripe',
        sensitive: false,
      },
      {
        id: legacySecretFieldId('secret-1', 'token', 0),
        key: 'token',
        value: 'secret-value',
        sensitive: true,
      },
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

  it('resolves fields without mutating usage metadata', () => {
    const vault = {
      root: {
        secrets: [{
          id: 'secret-1',
          usageCount: 8,
          fields: [
            { key: 'Service', value: 'Stripe', sensitive: false },
            { key: 'token', value: 'secret-value', sensitive: true },
          ],
        }],
        children: [],
      },
    }

    expect(resolveSecretFieldInVault(vault, 'secret-1', 'token')).toBe('secret-value')
    expect(resolveSecretFieldsInVault(vault, 'secret-1')).toHaveLength(2)
    expect(vault.root.secrets[0].usageCount).toBe(8)
  })

  it('resolves duplicate labels only through stable field identity', () => {
    const vault = {
      root: {
        secrets: [{
          id: 'secret-1',
          fields: [
            { id: 'field-first', key: 'token', value: 'first', sensitive: true },
            { id: 'field-second', key: 'token', value: 'second', sensitive: true },
          ],
        }],
        children: [],
      },
    }

    expect(resolveSecretFieldInVault(vault, 'secret-1', 'token', 'field-second')).toBe('second')
    expect(() => resolveSecretFieldInVault(vault, 'secret-1', 'token')).toThrow('ambiguous')
    expect(() => resolveSecretFieldInVault(vault, 'secret-1', 'token', 'missing-field'))
      .toThrow('identity is unavailable')
    expect(() => resolveSecretFieldInVault(vault, 'secret-1', 'renamed', 'field-second'))
      .toThrow('label is stale')
  })

  it('applies aggregate deltas in one traversal and reports deleted secrets', () => {
    const result = trackSecretUsageBatchInVault({
      root: {
        secrets: [{ id: 'secret-1', usageCount: 4, updatedAt: '2026-05-30T00:00:00.000Z' }],
        children: [],
      },
    }, [
      { secretId: 'secret-1', count: 20, lastUsedAt: '2026-05-29T12:00:00.000Z' },
      { secretId: 'deleted', count: 2, lastUsedAt: '2026-05-29T13:00:00.000Z' },
    ])

    expect(result).toMatchObject({ appliedCount: 20, missingSecretIds: ['deleted'] })
    expect((result.vault as any).root.secrets[0]).toMatchObject({
      usageCount: 24,
      lastUsedAt: '2026-05-29T12:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
    })
  })

})
