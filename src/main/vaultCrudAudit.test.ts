import { describe, expect, it } from 'vitest'
import { sanitizeAuditDetails } from './audit'
import { deriveVaultCrudAuditEntries } from './vaultCrudAudit'

describe('deriveVaultCrudAuditEntries', () => {
  it('reports semantic CRUD categories without putting names, notes, or values in details', () => {
    const before = sampleVault()
    const after = structuredClone(before)
    after.root.secrets[0].fields[0].value = 'new-secret-value-never-log'
    after.root.secrets[0].notes = 'new private note never log'
    after.root.children.push({
      id: 'folder-new',
      name: 'Customer name never log',
      children: [],
      secrets: [{
        id: 'secret-new',
        name: 'Production credential never log',
        type: 'apiKey',
        fields: [{ key: 'token', value: 'created-secret-never-log', sensitive: true }],
        notes: '',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }],
      itemOrder: [{ kind: 'secret', id: 'secret-new' }],
    })
    after.root.itemOrder.push({ kind: 'folder', id: 'folder-new' })
    after.providers[0].config.token = 'new-provider-token-never-log'
    after.preferences = { clipboardClearSeconds: 10 }

    const events = deriveVaultCrudAuditEntries(before, after, 8)
    const byType = new Map(events.map(event => [event.type, event]))

    expect(byType.get('vault.secret.updated')?.details).toMatchObject({
      revision: 8,
      count: 1,
      vaultItemIds: ['secret-a'],
    })
    expect(byType.get('vault.secret.created')?.details).toMatchObject({
      count: 1,
      vaultItemIds: ['secret-new'],
    })
    expect(byType.get('vault.folder.created')?.details).toMatchObject({
      count: 1,
      vaultItemIds: ['folder-new'],
    })
    expect(byType.has('vault.folder.updated')).toBe(true)
    expect(byType.has('vault.provider_config.updated')).toBe(true)
    expect(byType.has('vault.preferences.updated')).toBe(true)

    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('new-secret-value-never-log')
    expect(serialized).not.toContain('private note')
    expect(serialized).not.toContain('Customer name')
    expect(serialized).not.toContain('new-provider-token')
    for (const event of events) expect(sanitizeAuditDetails(event.details)).toEqual(event.details)
  })

  it('records moves as updates and deletions as bounded summaries', () => {
    const before = sampleVault()
    for (let index = 0; index < 80; index += 1) {
      before.root.secrets.push({
        ...structuredClone(before.root.secrets[0]),
        id: `deleted-${index}`,
      })
    }
    const after = structuredClone(before)
    after.root.secrets = []
    after.root.children[0].secrets = [before.root.secrets[0]]

    const events = deriveVaultCrudAuditEntries(before, after, 9)
    const deleted = events.find(event => event.type === 'vault.secret.deleted')
    const updated = events.find(event => event.type === 'vault.secret.updated')

    expect(deleted?.details).toMatchObject({ count: 80, omittedCount: 30 })
    expect((deleted?.details.vaultItemIds as string[])).toHaveLength(50)
    expect(updated?.details).toMatchObject({ count: 1, vaultItemIds: ['secret-a'] })
  })

  it('emits no CRUD event for an unchanged vault revision update', () => {
    const before = sampleVault()
    const after = { ...structuredClone(before), revision: 7 }

    expect(deriveVaultCrudAuditEntries(before, after, 7)).toEqual([])
  })
})

function sampleVault(): any {
  return {
    version: 2,
    revision: 6,
    root: {
      id: 'root',
      name: 'Vault',
      children: [{
        id: 'folder-child',
        name: 'Child',
        children: [],
        secrets: [],
        itemOrder: [],
      }],
      secrets: [{
        id: 'secret-a',
        name: 'Secret A',
        type: 'apiKey',
        fields: [{ key: 'token', value: 'old-secret-value-never-log', sensitive: true }],
        notes: 'private note never log',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      itemOrder: [
        { kind: 'secret', id: 'secret-a' },
        { kind: 'folder', id: 'folder-child' },
      ],
    },
    providers: [{
      id: 'provider-a',
      name: 'Provider',
      type: 'custom',
      config: { token: 'old-provider-token-never-log' },
    }],
    providerGroups: [],
    envProjects: [],
  }
}
