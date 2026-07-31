import { describe, expect, it, vi } from 'vitest'
import type { VaultRoot } from './types'
import { TransientRevealGate } from './lib/useTransientReveal'

vi.mock('#service-categories', () => ({
  providerTypeCategory: () => 'developer-tools',
  serviceCategoryLabel: () => 'Developer Tools',
}))

import {
  RendererVaultMutationQueue,
  RendererVaultSessionChangedError,
  RendererVaultSessionGuard,
  canInstallVaultSnapshot,
  reconcileSnapshotSelection,
  trackSecretUsage,
} from './vaultContext'

function vault(rootId: string, revision?: number): VaultRoot {
  return {
    version: 2,
    revision,
    root: {
      id: rootId,
      name: 'Vault',
      children: [],
      secrets: [],
      itemOrder: [],
    },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('canInstallVaultSnapshot', () => {
  it('accepts the first snapshot when no vault is installed', () => {
    expect(canInstallVaultSnapshot(null, vault('vault-a', 1))).toBe(true)
  })

  it('accepts only a strictly newer revision for the same root by default', () => {
    const current = vault('vault-a', 7)

    expect(canInstallVaultSnapshot(current, vault('vault-a', 6))).toBe(false)
    expect(canInstallVaultSnapshot(current, vault('vault-a', 7))).toBe(false)
    expect(canInstallVaultSnapshot(current, vault('vault-a', 8))).toBe(true)
  })

  it('allows an equal revision only when explicitly requested', () => {
    const current = vault('vault-a', 7)

    expect(canInstallVaultSnapshot(current, vault('vault-a', 7), true)).toBe(true)
    expect(canInstallVaultSnapshot(current, vault('vault-a', 6), true)).toBe(false)
  })

  it('treats a missing legacy revision as revision one', () => {
    const current = vault('vault-a')

    expect(canInstallVaultSnapshot(current, vault('vault-a'))).toBe(false)
    expect(canInstallVaultSnapshot(current, vault('vault-a', 2))).toBe(true)
  })

  it('rejects a newer snapshot belonging to a different root', () => {
    expect(canInstallVaultSnapshot(vault('vault-a', 7), vault('vault-b', 8))).toBe(false)
  })

  it('does not regress after a newer response was installed first', () => {
    const installed = vault('vault-a', 12)

    expect(canInstallVaultSnapshot(installed, vault('vault-a', 11))).toBe(false)
    expect(canInstallVaultSnapshot(installed, vault('vault-a', 12))).toBe(false)
    expect(canInstallVaultSnapshot(installed, vault('vault-a', 13))).toBe(true)
  })
})

describe('trackSecretUsage', () => {
  it('updates usage metadata without changing the secret content identity', () => {
    const originalUpdatedAt = '2026-07-11T00:00:00.000Z'
    const usedAt = '2026-07-22T12:00:00.000Z'
    const current: VaultRoot = {
      ...vault('vault-a', 7),
      root: {
        id: 'vault-a',
        name: 'Vault',
        children: [],
        secrets: [{
          id: 'secret-a',
          name: 'Secret A',
          type: 'password',
          fields: [{ id: 'field-a', key: 'Password', value: '', sensitive: true }],
          notes: '',
          createdAt: originalUpdatedAt,
          updatedAt: originalUpdatedAt,
          usageCount: 4,
        }],
        itemOrder: [{ kind: 'secret', id: 'secret-a' }],
      },
    }
    const gate = new TransientRevealGate()
    const originalIdentity = 'secret-a:2026-07-11T00:00:00.000Z'
    const inFlightReveal = gate.begin(originalIdentity)

    const tracked = trackSecretUsage(current, 'secret-a', usedAt)
    const trackedSecret = tracked.root.secrets[0]
    const trackedIdentity = `${trackedSecret?.id}:${trackedSecret?.updatedAt}`

    expect(trackedSecret).toMatchObject({
      updatedAt: originalUpdatedAt,
      lastUsedAt: usedAt,
      usageCount: 5,
    })
    expect(trackedIdentity).toBe(originalIdentity)
    expect(gate.isCurrent(inFlightReveal, trackedIdentity)).toBe(true)
  })
})

describe('RendererVaultSessionGuard', () => {
  it('invalidates an old authentication response when another session wins', () => {
    const guard = new RendererVaultSessionGuard()
    const oldPasswordAttempt = guard.captureAuthAttempt()

    guard.begin()

    expect(guard.isAuthAttemptCurrent(oldPasswordAttempt)).toBe(false)
    expect(guard.unlocked).toBe(true)
  })

  it('invalidates a pending unlock response when the user locks', () => {
    const guard = new RendererVaultSessionGuard()
    const pendingUnlock = guard.captureAuthAttempt()

    guard.end()

    expect(guard.isAuthAttemptCurrent(pendingUnlock)).toBe(false)
    expect(guard.unlocked).toBe(false)
  })

  it('never makes an old epoch current after lock and re-unlock', () => {
    const guard = new RendererVaultSessionGuard()
    const oldEpoch = guard.begin()

    guard.end()
    const newEpoch = guard.begin()

    expect(newEpoch).toBeGreaterThan(oldEpoch)
    expect(guard.isCurrent(oldEpoch)).toBe(false)
    expect(guard.isCurrent(newEpoch)).toBe(true)
  })
})

describe('RendererVaultMutationQueue', () => {
  it('drops an old response and all queued work across lock and re-unlock', async () => {
    const guard = new RendererVaultSessionGuard()
    const queue = new RendererVaultMutationQueue()
    const oldEpoch = guard.begin()
    const firstCommit = deferred<string>()
    const secondCommit = vi.fn(async () => 'must-not-run')

    const first = queue.enqueue(oldEpoch, epoch => guard.isCurrent(epoch), () => firstCommit.promise)
    const second = queue.enqueue(oldEpoch, epoch => guard.isCurrent(epoch), secondCommit)
    await Promise.resolve()

    guard.end()
    queue.reset()
    const newEpoch = guard.begin()
    const freshCommit = queue.enqueue(newEpoch, epoch => guard.isCurrent(epoch), async () => 'new-session')
    await expect(freshCommit).resolves.toBe('new-session')

    firstCommit.resolve('old-session-response')

    const [firstResult, secondResult] = await Promise.allSettled([first, second])
    expect(firstResult).toMatchObject({ status: 'rejected' })
    expect(secondResult).toMatchObject({ status: 'rejected' })
    if (firstResult.status === 'rejected') {
      expect(firstResult.reason).toBeInstanceOf(RendererVaultSessionChangedError)
    }
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason).toBeInstanceOf(RendererVaultSessionChangedError)
    }
    expect(secondCommit).not.toHaveBeenCalled()
  })

  it('serialises commands that remain in the same unlocked session', async () => {
    const guard = new RendererVaultSessionGuard()
    const queue = new RendererVaultMutationQueue()
    const epoch = guard.begin()
    const releaseFirst = deferred<void>()
    const order: string[] = []

    const first = queue.enqueue(epoch, value => guard.isCurrent(value), async () => {
      order.push('first:start')
      await releaseFirst.promise
      order.push('first:end')
      return 'first'
    })
    const second = queue.enqueue(epoch, value => guard.isCurrent(value), async () => {
      order.push('second')
      return 'second'
    })
    await Promise.resolve()
    expect(order).toEqual(['first:start'])

    releaseFirst.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })
})

describe('reconcileSnapshotSelection', () => {
  function navigableVault(): VaultRoot {
    return {
      ...vault('root', 4),
      root: {
        id: 'root',
        name: 'Vault',
        secrets: [],
        children: [{
          id: 'ancestor',
          name: 'Ancestor',
          secrets: [{
            id: 'secret-a',
            name: 'Secret A',
            type: 'apiKey',
            fields: [{ id: 'field-a', key: 'token', value: '', sensitive: true }],
            notes: '',
            createdAt: '2026-07-11T00:00:00.000Z',
            updatedAt: '2026-07-11T00:00:00.000Z',
          }],
          children: [],
          itemOrder: [{ kind: 'secret', id: 'secret-a' }],
        }],
        itemOrder: [{ kind: 'folder', id: 'ancestor' }],
      },
    }
  }

  it('falls back to root and clears the secret after a remote ancestor deletion', () => {
    const updated = vault('root', 5)

    expect(reconcileSnapshotSelection({
      selectedFolderId: 'ancestor',
      selectedSecretId: 'secret-a',
    }, updated)).toEqual({
      selectedFolderId: 'root',
      selectedSecretId: null,
    })
  })

  it('keeps a selected secret and follows it when its old folder disappears', () => {
    const initial = navigableVault()
    const secret = initial.root.children[0].secrets[0]
    const moved: VaultRoot = {
      ...initial,
      revision: 5,
      root: {
        ...initial.root,
        children: [{
          id: 'destination',
          name: 'Destination',
          secrets: [secret],
          children: [],
          itemOrder: [{ kind: 'secret', id: secret.id }],
        }],
        itemOrder: [{ kind: 'folder', id: 'destination' }],
      },
    }

    expect(reconcileSnapshotSelection({
      selectedFolderId: 'ancestor',
      selectedSecretId: secret.id,
    }, moved)).toEqual({
      selectedFolderId: 'destination',
      selectedSecretId: secret.id,
    })
  })
})
