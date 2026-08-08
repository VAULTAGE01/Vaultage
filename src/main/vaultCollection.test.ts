import { describe, expect, it } from 'vitest'
import {
  createVaultCollectionManifest,
  requireVaultCollectionEntry,
  summarizeVaultCollection,
  validateExactVaultId,
  validateVaultCollectionManifest,
} from './vaultCollection'
import type { VaultRecordManifest } from './vaultRecordStore'

describe('vaultCollection', () => {
  it('wraps one legacy vault as Default without changing its stable id', () => {
    const collection = createVaultCollectionManifest({
      id: 'existing-root-id',
      manifest: recordManifest('a'),
      now: '2026-08-02T12:00:00.000Z',
    })

    expect(summarizeVaultCollection(collection)).toEqual({
      revision: 1,
      activeVaultId: 'existing-root-id',
      vaults: [{
        id: 'existing-root-id',
        name: 'Default',
        createdAt: '2026-08-02T12:00:00.000Z',
        updatedAt: '2026-08-02T12:00:00.000Z',
        archived: false,
      }],
    })
  })

  it('rejects malformed, missing, duplicate, and archived active ids', () => {
    const first = entry('vault-a', 'a')
    const second = entry('vault-b', 'b')
    const base = {
      format: 'vaultage.vault-collection.v1',
      storageVersion: 1,
      revision: 3,
      activeVaultId: 'vault-a',
      vaults: [first, second],
    }

    expect(validateVaultCollectionManifest(base)).toMatchObject({ activeVaultId: 'vault-a' })
    expect(() => validateVaultCollectionManifest({ ...base, activeVaultId: 'missing' }))
      .toThrow('active vault does not exist')
    expect(() => validateVaultCollectionManifest({ ...base, vaults: [first, first] }))
      .toThrow('duplicate vault id')
    expect(() => validateVaultCollectionManifest({
      ...base,
      vaults: [{ ...first, archived: true }, second],
    })).toThrow('active vault cannot be archived')
    expect(() => validateVaultCollectionManifest({ ...base, extra: true }))
      .toThrow('unsupported property')
    expect(() => validateExactVaultId(' vault-a')).toThrow('Invalid vault id')
    expect(() => validateExactVaultId('vault-a\n')).toThrow('Invalid vault id')
  })

  it('requires exact vault ids rather than falling back to the active vault', () => {
    const collection = validateVaultCollectionManifest({
      format: 'vaultage.vault-collection.v1',
      storageVersion: 1,
      revision: 2,
      activeVaultId: 'vault-a',
      vaults: [entry('vault-a', 'a'), entry('vault-b', 'b')],
    })

    expect(requireVaultCollectionEntry(collection, 'vault-b').id).toBe('vault-b')
    expect(() => requireVaultCollectionEntry(collection, 'vault-c')).toThrow('Vault does not exist')
    expect(() => requireVaultCollectionEntry(collection, undefined)).toThrow('Invalid vault id')
  })
})

function entry(id: string, recordId: string) {
  return {
    id,
    name: id,
    createdAt: '2026-08-02T12:00:00.000Z',
    updatedAt: '2026-08-02T12:00:00.000Z',
    archived: false,
    manifest: recordManifest(recordId),
  }
}

function recordManifest(seed: string): VaultRecordManifest {
  const id = seed.repeat(64)
  return {
    format: 'vaultage.record-store.v1',
    storageVersion: 1,
    vaultVersion: 2,
    revision: 1,
    root: id,
    providers: [],
    providerGroups: [],
    providerGroupsPresent: true,
    envProjects: [],
  }
}
