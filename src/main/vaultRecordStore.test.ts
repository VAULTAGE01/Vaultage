import { join } from 'path'
import { promises as fs } from 'fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decodeVaultRecordStore,
  decodeVaultRecordStoreFromBlobs,
  encodeVaultRecordStore,
  garbageCollectVaultRecords,
  readVaultRecordBlobs,
} from './vaultRecordStore'

const ROOT = `/tmp/vaultage-record-store-${process.pid}-${Math.random().toString(16).slice(2)}`
const RECORDS = join(ROOT, 'records')
const KEY = Buffer.alloc(32, 7)

describe('vaultRecordStore', () => {
  beforeEach(async () => fs.rm(ROOT, { recursive: true, force: true }))
  afterEach(async () => fs.rm(ROOT, { recursive: true, force: true }))

  it('round-trips a canonical vault through independently encrypted records', async () => {
    const vault = sampleVault()
    const encoded = await encodeVaultRecordStore(vault, KEY, RECORDS)
    const decoded = await decodeVaultRecordStore(encoded.manifest, KEY, RECORDS)

    expect(decoded.vault).toEqual(vault)
    expect(decoded.recordIds).toEqual(encoded.recordIds)
    expect(encoded.recordsWritten).toBe(9)
    expect((await fs.readdir(RECORDS)).length).toBe(9)
  })

  it('writes only a changed secret and its folder ancestry on the next commit', async () => {
    const first = await encodeVaultRecordStore(sampleVault(), KEY, RECORDS)
    const changed = sampleVault()
    changed.root.children[0].secrets[0].name = 'Changed nested secret'

    const second = await encodeVaultRecordStore(changed, KEY, RECORDS, {
      trustedRecordIds: first.recordIds,
    })
    const decoded = await decodeVaultRecordStore(second.manifest, KEY, RECORDS)

    expect(second.recordsWritten).toBe(3)
    expect((decoded.vault as any).root.children[0].secrets[0].name).toBe('Changed nested secret')
    expect(second.recordIds.size).toBe(first.recordIds.size)
    expect((await fs.readdir(RECORDS)).length).toBe(12)
  })

  it('fails closed for tampered records and the wrong vault key', async () => {
    const encoded = await encodeVaultRecordStore(sampleVault(), KEY, RECORDS)
    const [recordId] = encoded.recordIds
    await fs.writeFile(join(RECORDS, `${recordId}.enc`), Buffer.alloc(64, 9))

    await expect(decodeVaultRecordStore(encoded.manifest, KEY, RECORDS)).rejects.toThrow()
    await expect(
      decodeVaultRecordStore(encoded.manifest, Buffer.alloc(32, 8), RECORDS),
    ).rejects.toThrow()
  })

  it('verifies and decodes a bounded backup blob map', async () => {
    const vault = sampleVault()
    const encoded = await encodeVaultRecordStore(vault, KEY, RECORDS)
    const blobs = await readVaultRecordBlobs(RECORDS, encoded.recordIds)
    const restored = await decodeVaultRecordStoreFromBlobs(encoded.manifest, KEY, blobs)

    expect(restored.vault).toEqual(vault)
    blobs.delete([...encoded.recordIds][0])
    await expect(decodeVaultRecordStoreFromBlobs(encoded.manifest, KEY, blobs)).rejects.toThrow('missing')
  })

  it('garbage-collects only old unreferenced record files', async () => {
    const encoded = await encodeVaultRecordStore(sampleVault(), KEY, RECORDS)
    const oldOrphan = 'f'.repeat(64)
    const youngOrphan = 'e'.repeat(64)
    await fs.writeFile(join(RECORDS, `${oldOrphan}.enc`), Buffer.alloc(64, 1))
    await fs.writeFile(join(RECORDS, `${youngOrphan}.enc`), Buffer.alloc(64, 1))
    await fs.utimes(join(RECORDS, `${oldOrphan}.enc`), new Date(0), new Date(0))

    const removed = await garbageCollectVaultRecords(RECORDS, encoded.recordIds, {
      nowMs: Date.now(),
      graceMs: 60_000,
    })

    expect(removed).toBe(1)
    await expect(fs.access(join(RECORDS, `${oldOrphan}.enc`))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(join(RECORDS, `${youngOrphan}.enc`))).resolves.toBeUndefined()
  })
})

function sampleVault(): any {
  return {
    version: 2,
    revision: 9,
    root: {
      id: 'root',
      name: 'Vault',
      children: [{
        id: 'folder-a',
        name: 'Folder A',
        children: [],
        secrets: [{
          id: 'secret-b',
          name: 'Nested secret',
          type: 'secureNote',
          fields: [{ key: 'Content', value: 'nested value', sensitive: true }],
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        itemOrder: [{ kind: 'secret', id: 'secret-b' }],
      }],
      secrets: [{
        id: 'secret-a',
        name: 'Secret A',
        type: 'apiKey',
        fields: [{ key: 'token', value: 'secret value', sensitive: true }],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        providerLink: {
          providerId: 'provider-a',
          remoteName: 'token',
          createdInVaultage: true,
        },
      }],
      itemOrder: [
        { kind: 'folder', id: 'folder-a' },
        { kind: 'secret', id: 'secret-a' },
      ],
    },
    providers: [{
      id: 'provider-a',
      name: 'Provider A',
      type: 'custom',
      config: { baseUrl: 'https://api.example.com', token: 'provider token' },
      groupId: 'group-a',
    }],
    providerGroups: [{ id: 'group-a', name: 'Providers' }],
    envProjects: [{
      id: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      addToGitignore: true,
      entries: [{ secretId: 'secret-a', fieldKey: 'token', envKey: 'TOKEN' }],
    }],
    preferences: { localDashboardPinnedOrder: ['secret:secret-a'] },
    _vaultage: {
      recentUsageBatches: [{ id: '00000000-0000-4000-8000-000000000001', revision: 9 }],
    },
  }
}
