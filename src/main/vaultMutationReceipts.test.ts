import { describe, expect, it } from 'vitest'
import type { VaultCrudAuditEntry } from './vaultCrudAudit'
import {
  MAX_MUTATION_RECEIPT_ENTITY_IDS,
  MAX_RECENT_MUTATION_RECEIPTS,
  auditEntriesFromVaultMutationReceipt,
  fingerprintVaultMutationCommand,
  findVaultMutationReceipt,
  pendingAuditEntriesFromVaultMutationReceipts,
  withVaultMutationReceipt,
} from './vaultMutationReceipts'

describe('vault mutation receipts', () => {
  it('persists only bounded identifiers/counts and reconstructs reconciliable audit work', () => {
    const sensitiveValue = 'plaintext-must-never-enter-receipt'
    const auditEntries: VaultCrudAuditEntry[] = [{
      type: 'vault.secret.updated',
      details: {
        revision: 7,
        entityKind: 'secret',
        count: 25,
        vaultItemIds: Array.from({ length: 25 }, (_, index) => `secret-${index}`),
        omittedCount: 0,
        secretValue: sensitiveValue,
      },
    }]
    const id = '00000000-0000-4000-8000-000000000007'
    const command = { type: 'secret.update', secret: { value: sensitiveValue } }
    const { vault, receipt } = withVaultMutationReceipt(baseVault(), {
      id,
      revision: 7,
      commandType: 'secret.update',
      commandFingerprint: fingerprintVaultMutationCommand(command),
      commandResult: { secretValue: sensitiveValue },
      auditEntries,
    })

    expect(JSON.stringify(vault)).not.toContain(sensitiveValue)
    expect(receipt.audit[0]).toMatchObject({
      count: 25,
      omittedCount: 5,
      vaultItemIds: expect.any(Array),
    })
    expect(receipt.audit[0].vaultItemIds).toHaveLength(MAX_MUTATION_RECEIPT_ENTITY_IDS)
    expect(auditEntriesFromVaultMutationReceipt(receipt)).toEqual([{
      type: 'vault.secret.updated',
      details: {
        revision: 7,
        mutationId: id,
        receiptAuditIndex: 0,
        entityKind: 'secret',
        count: 25,
        vaultItemIds: Array.from({ length: 20 }, (_, index) => `secret-${index}`),
        omittedCount: 5,
      },
    }])
  })

  it('reconciles only receipt audit entries absent from authenticated history', () => {
    const id = 'mutation-reconcile'
    const received = withVaultMutationReceipt(baseVault(), {
      id,
      revision: 9,
      commandType: 'secret.update',
      commandFingerprint: fingerprintVaultMutationCommand({ type: 'secret.update', id: 'secret-a' }),
      auditEntries: [
        {
          type: 'vault.secret.updated',
          details: { entityKind: 'secret', count: 1, vaultItemIds: ['secret-a'], omittedCount: 0 },
        },
        { type: 'vault.preferences.updated', details: {} },
      ],
    })
    const pending = pendingAuditEntriesFromVaultMutationReceipts(received.vault, [{
      id: 'audit-1',
      timestamp: '2026-07-11T00:00:00.000Z',
      type: 'vault.secret.updated',
      details: { mutationId: id, receiptAuditIndex: 0 },
      previousHash: null,
      hash: 'hash',
    }])

    expect(pending).toEqual([{
      type: 'vault.preferences.updated',
      details: { revision: 9, mutationId: id, receiptAuditIndex: 1 },
    }])
  })

  it('retains a bounded tail and recovers the value-free command result', () => {
    let vault = baseVault()
    for (let revision = 1; revision <= MAX_RECENT_MUTATION_RECEIPTS + 3; revision += 1) {
      const command = { type: 'folder.duplicate', folderId: `folder-${revision}` }
      vault = withVaultMutationReceipt(vault, {
        id: `opaque-mutation-${revision}`,
        revision,
        commandType: 'folder.duplicate',
        commandFingerprint: fingerprintVaultMutationCommand(command),
        commandResult: {
          folderId: `folder-${revision}`,
          firstSecretId: `secret-${revision}`,
          secretCount: 1,
          leakedName: 'do not retain me',
        },
        auditEntries: [],
      }).vault
    }

    const internal = vault._vaultage as { recentMutationReceipts: unknown[] }
    expect(internal.recentMutationReceipts).toHaveLength(MAX_RECENT_MUTATION_RECEIPTS)
    expect(findVaultMutationReceipt(
      vault,
      'opaque-mutation-1',
      fingerprintVaultMutationCommand({ type: 'folder.duplicate', folderId: 'folder-1' }),
    )).toBeNull()
    expect(findVaultMutationReceipt(
      vault,
      `opaque-mutation-${MAX_RECENT_MUTATION_RECEIPTS + 3}`,
      fingerprintVaultMutationCommand({
        folderId: `folder-${MAX_RECENT_MUTATION_RECEIPTS + 3}`,
        type: 'folder.duplicate',
      }),
    )?.commandResult).toEqual({
      folderId: `folder-${MAX_RECENT_MUTATION_RECEIPTS + 3}`,
      firstSecretId: `secret-${MAX_RECENT_MUTATION_RECEIPTS + 3}`,
      secretCount: 1,
    })
    expect(JSON.stringify(vault)).not.toContain('do not retain me')
  })

  it('preserves other main-owned internal state and ignores malformed receipts', () => {
    const vault = baseVault()
    vault._vaultage = {
      recentUsageBatches: [{ id: 'usage-id', revision: 2 }],
      recentMutationReceipts: [{ id: 'not-a-uuid', revision: 2 }],
    }
    const id = '00000000-0000-4000-8000-000000000003'
    const commandFingerprint = fingerprintVaultMutationCommand({ type: 'preferences.patch', patch: {} })
    const next = withVaultMutationReceipt(vault, {
      id,
      revision: 3,
      commandType: 'preferences.patch',
      commandFingerprint,
      auditEntries: [{ type: 'vault.preferences.updated', details: { revision: 3 } }],
    }).vault

    expect((next._vaultage as any).recentUsageBatches).toEqual([{ id: 'usage-id', revision: 2 }])
    expect(findVaultMutationReceipt(next, id, commandFingerprint)).toMatchObject({
      revision: 3,
      commandType: 'preferences.patch',
    })
  })

  it('binds an opaque mutation id to the canonical semantic command', () => {
    const id = 'renderer-opaque-id'
    const original = { type: 'folder.rename', folderId: 'folder-a', name: 'Alpha' }
    const reordered = { name: 'Alpha', folderId: 'folder-a', type: 'folder.rename' }
    const changed = { type: 'folder.rename', folderId: 'folder-a', name: 'Beta' }
    const originalFingerprint = fingerprintVaultMutationCommand(original)
    const vault = withVaultMutationReceipt(baseVault(), {
      id,
      revision: 2,
      commandType: 'folder.rename',
      commandFingerprint: originalFingerprint,
      auditEntries: [],
    }).vault

    expect(fingerprintVaultMutationCommand(reordered)).toBe(originalFingerprint)
    expect(findVaultMutationReceipt(vault, id, fingerprintVaultMutationCommand(reordered))).not.toBeNull()
    expect(() => findVaultMutationReceipt(vault, id, fingerprintVaultMutationCommand(changed)))
      .toThrow('already used for a different command')
  })
})

function baseVault(): Record<string, any> {
  return {
    version: 2,
    revision: 1,
    root: { id: 'root', name: 'Vault', children: [], secrets: [], itemOrder: [] },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}
