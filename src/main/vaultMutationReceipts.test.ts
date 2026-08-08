import { describe, expect, it } from 'vitest'
import type { VaultCrudAuditEntry } from './vaultCrudAudit'
import {
  MAX_MUTATION_RECEIPT_ENTITY_IDS,
  MAX_RECENT_MUTATION_RECEIPTS,
  auditEntriesFromVaultMutationReceipt,
  fingerprintVaultMutationCommand,
  findVaultMutationReceipt,
  listVaultMutationReceipts,
  migrateLegacyVaultMutationReceipts,
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
      vaultId: 'root',
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
        vaultId: 'root',
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
      vaultId: 'root',
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
      details: { mutationId: id, vaultId: 'root', receiptAuditIndex: 0 },
      previousHash: null,
      hash: 'hash',
    }], 'root')

    expect(pending).toEqual([{
      type: 'vault.preferences.updated',
      details: { revision: 9, mutationId: id, vaultId: 'root', receiptAuditIndex: 1 },
    }])
  })

  it('migrates a pending single-vault receipt only into its enclosing default vault scope', () => {
    const id = 'legacy-pending-receipt'
    const written = withVaultMutationReceipt(baseVault(), {
      id,
      vaultId: 'root',
      revision: 6,
      commandType: 'preferences.patch',
      commandFingerprint: fingerprintVaultMutationCommand({ type: 'preferences.patch', patch: {} }),
      auditEntries: [{ type: 'vault.preferences.updated', details: {} }],
    }).vault
    const legacy = withoutReceiptVaultId(written)

    const migrated = migrateLegacyVaultMutationReceipts(legacy, 'root')
    expect(listVaultMutationReceipts(migrated)).toMatchObject([{
      id,
      vaultId: 'root',
      legacyAuditScope: true,
    }])
    expect(pendingAuditEntriesFromVaultMutationReceipts(migrated, [], 'root')).toEqual([{
      type: 'vault.preferences.updated',
      details: { revision: 6, mutationId: id, vaultId: 'root', receiptAuditIndex: 0 },
    }])
    expect(pendingAuditEntriesFromVaultMutationReceipts(migrated, [], 'other-vault')).toEqual([])
  })

  it('does not duplicate a published pre-vault-id audit event from the legacy default vault', () => {
    const id = 'legacy-published-receipt'
    const written = withVaultMutationReceipt(baseVault(), {
      id,
      vaultId: 'root',
      revision: 7,
      commandType: 'preferences.patch',
      commandFingerprint: fingerprintVaultMutationCommand({ type: 'preferences.patch', patch: {} }),
      auditEntries: [{ type: 'vault.preferences.updated', details: {} }],
    }).vault
    const migrated = migrateLegacyVaultMutationReceipts(withoutReceiptVaultId(written), 'root')

    expect(pendingAuditEntriesFromVaultMutationReceipts(migrated, [{
      id: 'legacy-audit-event',
      timestamp: '2026-08-06T00:00:00.000Z',
      type: 'vault.preferences.updated',
      details: { mutationId: id, receiptAuditIndex: 0 },
      previousHash: null,
      hash: 'hash',
    }], 'root')).toEqual([])
  })

  it('recovers an unindexed legacy receipt tail after an indexed pre-vault-id audit event', () => {
    const id = 'legacy-partially-published-receipt'
    const written = withVaultMutationReceipt(baseVault(), {
      id,
      vaultId: 'root',
      revision: 8,
      commandType: 'preferences.patch',
      commandFingerprint: fingerprintVaultMutationCommand({ type: 'preferences.patch', patch: {} }),
      auditEntries: [
        { type: 'vault.preferences.updated', details: {} },
        { type: 'vault.preferences.updated', details: {} },
      ],
    }).vault
    const migrated = migrateLegacyVaultMutationReceipts(withoutReceiptVaultId(written), 'root')

    expect(pendingAuditEntriesFromVaultMutationReceipts(migrated, [{
      id: 'legacy-first-audit-event',
      timestamp: '2026-08-06T00:00:00.000Z',
      type: 'vault.preferences.updated',
      details: { mutationId: id, receiptAuditIndex: 0 },
      previousHash: null,
      hash: 'hash',
    }], 'root')).toEqual([{
      type: 'vault.preferences.updated',
      details: { revision: 8, mutationId: id, vaultId: 'root', receiptAuditIndex: 1 },
    }])
  })

  it('keeps an inactive vault receipt independent when another vault reused its operation id', () => {
    const id = 'shared-operation-id'
    const received = withVaultMutationReceipt(baseVault(), {
      id,
      vaultId: 'vault-inactive',
      revision: 4,
      commandType: 'preferences.patch',
      commandFingerprint: fingerprintVaultMutationCommand({ type: 'preferences.patch', patch: {} }),
      auditEntries: [{ type: 'vault.preferences.updated', details: {} }],
    })
    const pending = pendingAuditEntriesFromVaultMutationReceipts(received.vault, [{
      id: 'audit-from-active-vault',
      timestamp: '2026-08-06T00:00:00.000Z',
      type: 'vault.preferences.updated',
      details: { mutationId: id, vaultId: 'vault-active', receiptAuditIndex: 0 },
      previousHash: null,
      hash: 'hash',
    }], 'vault-inactive')

    expect(pending).toEqual([{
      type: 'vault.preferences.updated',
      details: { revision: 4, mutationId: id, vaultId: 'vault-inactive', receiptAuditIndex: 0 },
    }])
  })

  it('retains a bounded tail and recovers the value-free command result', () => {
    let vault = baseVault()
    for (let revision = 1; revision <= MAX_RECENT_MUTATION_RECEIPTS + 3; revision += 1) {
      const command = { type: 'folder.duplicate', folderId: `folder-${revision}` }
      vault = withVaultMutationReceipt(vault, {
        id: `opaque-mutation-${revision}`,
        vaultId: 'root',
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
      vaultId: 'root',
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
      vaultId: 'root',
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

function withoutReceiptVaultId(vault: Record<string, any>): Record<string, any> {
  const clone = structuredClone(vault)
  const receipts = clone._vaultage.recentMutationReceipts as Array<Record<string, unknown>>
  clone._vaultage.recentMutationReceipts = receipts.map(({ vaultId: _vaultId, ...receipt }) => receipt)
  return clone
}
