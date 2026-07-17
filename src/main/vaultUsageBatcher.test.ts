import { describe, expect, it, vi } from 'vitest'
import { VaultSessionChangedError } from './vaultSessionKey'
import { isUsageOnlyRevisionRange, VaultUsageBatcher } from './vaultUsageBatcher'
import type { updateVault as updateVaultType } from './vaultStorage'

describe('VaultUsageBatcher', () => {
  it('aggregates a 10,000-event load into one encrypted-vault update', async () => {
    const harness = createHarness()
    const batcher = harness.batcher({ flushEventLimit: 20_000 })

    for (let index = 0; index < 10_000; index += 1) {
      batcher.record('secret-a', new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString())
    }
    await batcher.flush()

    expect(harness.updateVault).toHaveBeenCalledOnce()
    expect(secret(harness.vault(), 'secret-a')).toMatchObject({
      usageCount: 10_002,
      lastUsedAt: '2026-01-01T00:00:59.000Z',
      updatedAt: '2026-01-01T00:00:59.000Z',
    })
    expect(batcher.pendingEventCount()).toBe(0)
    expect(harness.changed).toHaveBeenCalledWith(expect.objectContaining({
      revision: 2,
      source: 'usage-batch',
    }))
    expect(secret(harness.changed.mock.calls[0][0].data, 'secret-a').usageCount).toBe(10_002)
  })

  it('aggregates counts per secret and keeps the latest timestamp', async () => {
    const harness = createHarness()
    const batcher = harness.batcher()
    batcher.record('secret-a', '2026-01-01T12:00:03.000Z')
    batcher.record('secret-b', '2026-01-01T12:00:04.000Z')
    batcher.record('secret-a', '2026-01-01T12:00:01.000Z')

    const result = await batcher.flush()

    expect(result).toMatchObject({ batches: 1, eventCount: 3, appliedCount: 3, revision: 2 })
    expect(secret(harness.vault(), 'secret-a')).toMatchObject({
      usageCount: 4,
      lastUsedAt: '2026-01-01T12:00:03.000Z',
    })
    expect(secret(harness.vault(), 'secret-b')).toMatchObject({
      usageCount: 1,
      lastUsedAt: '2026-01-01T12:00:04.000Z',
    })
  })

  it('retains a failed batch and retries it without losing events', async () => {
    const harness = createHarness({ failuresBeforeCommit: 1 })
    const batcher = harness.batcher()
    batcher.record('secret-a', '2026-01-01T12:00:00.000Z')
    batcher.record('secret-a', '2026-01-01T12:00:01.000Z')

    await expect(batcher.flush()).rejects.toThrow('simulated pre-commit failure')
    expect(batcher.pendingEventCount()).toBe(2)
    expect(secret(harness.vault(), 'secret-a').usageCount).toBe(2)

    await expect(batcher.flush()).resolves.toMatchObject({ appliedCount: 2 })
    expect(secret(harness.vault(), 'secret-a').usageCount).toBe(4)
    expect(batcher.pendingEventCount()).toBe(0)
  })

  it('uses a persisted batch marker to avoid double counts after an ambiguous committed write', async () => {
    const harness = createHarness({ failuresAfterCommit: 1 })
    const batcher = harness.batcher()
    batcher.record('secret-a', '2026-01-01T12:00:00.000Z')

    await expect(batcher.flush()).rejects.toThrow('simulated post-commit failure')
    expect(secret(harness.vault(), 'secret-a').usageCount).toBe(3)
    expect(batcher.pendingEventCount()).toBe(1)

    const recovered = await batcher.flush()
    expect(recovered).toMatchObject({ batches: 1, eventCount: 1, appliedCount: 0, revision: 2 })
    expect(secret(harness.vault(), 'secret-a').usageCount).toBe(3)
    expect(harness.changed).toHaveBeenCalledWith(expect.objectContaining({
      source: 'usage-batch-recovered',
    }))
  })

  it('broadcasts an in-flight commit plus newer pending usage exactly once', async () => {
    let persisted = sampleVault()
    let revision = 1
    let updateCount = 0
    let batcher!: VaultUsageBatcher
    const changed = vi.fn()
    const updateVault = vi.fn(async (_key, updater, options = {}) => {
      options.assertCurrent?.()
      const output = await updater(structuredClone(persisted))
      updateCount += 1
      if (updateCount === 1) {
        batcher.record('secret-a', '2026-01-01T12:00:02.000Z')
      }
      persisted = JSON.parse(output.json)
      options.assertCurrent?.()
      return output.result
    }) as unknown as typeof updateVaultType
    batcher = new VaultUsageBatcher({
      getVaultKey: () => Buffer.alloc(32, 7),
      getSessionEpoch: () => 1,
      getVaultRevision: () => revision,
      setVaultRevision: value => { revision = value },
      onVaultChanged: change => changed({
        ...change,
        data: batcher.decorateSnapshot(change.data),
      }),
      updateVault,
      flushIntervalMs: 60_000,
    })
    batcher.record('secret-a', '2026-01-01T12:00:01.000Z')

    await batcher.flush()

    expect(secret(persisted, 'secret-a').usageCount).toBe(3)
    expect(batcher.pendingEventCount()).toBe(1)
    expect(secret(changed.mock.calls[0][0].data, 'secret-a').usageCount).toBe(4)

    await batcher.flush()
    expect(secret(persisted, 'secret-a').usageCount).toBe(4)
    expect(secret(changed.mock.calls[1][0].data, 'secret-a').usageCount).toBe(4)
  })

  it('retains a batch while locked and safely resumes it for the same vault key', async () => {
    const harness = createHarness()
    const batcher = harness.batcher()
    batcher.record('secret-a', '2026-01-01T12:00:00.000Z')
    harness.lock()

    await expect(batcher.flush()).rejects.toBeInstanceOf(VaultSessionChangedError)
    expect(batcher.pendingEventCount()).toBe(1)

    harness.unlockSameVault()
    await expect(batcher.flush()).resolves.toMatchObject({ appliedCount: 1 })
    expect(secret(harness.vault(), 'secret-a').usageCount).toBe(3)
  })

  it('never applies retained usage to a different vault key', async () => {
    const dropped = vi.fn()
    const harness = createHarness()
    const batcher = harness.batcher({ onDroppedUsage: dropped })
    batcher.record('secret-a', '2026-01-01T12:00:00.000Z')
    harness.unlockDifferentVault()

    batcher.record('secret-b', '2026-01-01T12:00:01.000Z')
    await batcher.flush()

    expect(dropped).toHaveBeenCalledWith(1, 'vault-session-key-changed')
    expect(secret(harness.vault(), 'secret-a').usageCount).toBe(2)
    expect(secret(harness.vault(), 'secret-b').usageCount).toBe(1)
  })

  it('decorates renderer snapshots with queued optimistic metadata without exposing new values', () => {
    const harness = createHarness()
    const batcher = harness.batcher()
    batcher.record('secret-a', '2026-01-01T12:00:00.000Z')
    const redacted = sampleVault()
    secret(redacted, 'secret-a').fields = [{ key: 'token', value: '[redacted]', sensitive: true }]

    const decorated = batcher.decorateSnapshot(redacted)

    expect(secret(decorated, 'secret-a')).toMatchObject({ usageCount: 3 })
    expect(JSON.stringify(decorated)).not.toContain('secret-a-value')
  })

  it('proves only contiguous usage-batch revisions and rejects semantic gaps', () => {
    const vault = {
      _vaultage: {
        recentUsageBatches: [
          { id: '00000000-0000-4000-8000-000000000001', revision: 11 },
          { id: '00000000-0000-4000-8000-000000000002', revision: 12 },
          { id: '00000000-0000-4000-8000-000000000003', revision: 14 },
        ],
      },
    }

    expect(isUsageOnlyRevisionRange(vault, 10, 12)).toBe(true)
    expect(isUsageOnlyRevisionRange(vault, 10, 14)).toBe(false)
    expect(isUsageOnlyRevisionRange(vault, 12, 14)).toBe(false)
  })
})

function createHarness(options: {
  failuresBeforeCommit?: number
  failuresAfterCommit?: number
} = {}) {
  let persisted = sampleVault()
  let key: Buffer | null = Buffer.alloc(32, 7)
  let epoch = 1
  let revision = 1
  let failuresBeforeCommit = options.failuresBeforeCommit ?? 0
  let failuresAfterCommit = options.failuresAfterCommit ?? 0
  const changed = vi.fn()

  const updateVault = vi.fn(async (
    _key: Buffer,
    updater: (vault: unknown) => Promise<{ json: string; result: unknown }> | { json: string; result: unknown },
    updateOptions: { assertCurrent?: () => void } = {},
  ) => {
    updateOptions.assertCurrent?.()
    const output = await updater(structuredClone(persisted))
    updateOptions.assertCurrent?.()
    if (failuresBeforeCommit > 0) {
      failuresBeforeCommit -= 1
      throw new Error('simulated pre-commit failure')
    }
    persisted = JSON.parse(output.json)
    if (failuresAfterCommit > 0) {
      failuresAfterCommit -= 1
      throw new Error('simulated post-commit failure')
    }
    updateOptions.assertCurrent?.()
    return output.result
  }) as unknown as typeof updateVaultType

  return {
    updateVault,
    changed,
    vault: () => persisted,
    lock: () => {
      key = null
      epoch += 1
    },
    unlockSameVault: () => {
      key = Buffer.alloc(32, 7)
      epoch += 1
    },
    unlockDifferentVault: () => {
      key = Buffer.alloc(32, 9)
      epoch += 1
    },
    batcher: (overrides: Partial<ConstructorParameters<typeof VaultUsageBatcher>[0]> = {}) => (
      new VaultUsageBatcher({
        getVaultKey: () => key,
        getSessionEpoch: () => epoch,
        getVaultRevision: () => revision,
        setVaultRevision: value => { revision = value },
        onVaultChanged: changed,
        updateVault,
        flushIntervalMs: 60_000,
        ...overrides,
      })
    ),
  }
}

function sampleVault(): Record<string, any> {
  return {
    version: 2,
    revision: 1,
    root: {
      id: 'root',
      name: 'Vault',
      children: [],
      secrets: [
        {
          id: 'secret-a',
          name: 'Secret A',
          type: 'apiKey',
          fields: [{ key: 'token', value: 'secret-a-value', sensitive: true }],
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          usageCount: 2,
        },
        {
          id: 'secret-b',
          name: 'Secret B',
          type: 'apiKey',
          fields: [{ key: 'token', value: 'secret-b-value', sensitive: true }],
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      itemOrder: [
        { kind: 'secret', id: 'secret-a' },
        { kind: 'secret', id: 'secret-b' },
      ],
    },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function secret(vault: unknown, id: string): Record<string, any> {
  const root = (vault as { root: { secrets: Record<string, any>[] } }).root
  const found = root.secrets.find(candidate => candidate.id === id)
  if (!found) throw new Error(`Missing test secret ${id}`)
  return found
}
