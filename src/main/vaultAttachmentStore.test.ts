import { mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from './fileIO'
import { randomVaultKey } from './vaultCrypto'
import {
  VaultAttachmentStore,
  createVaultAttachmentRef,
  verifyVaultAttachmentBackupBlobMap,
} from './vaultAttachmentStore'
import { parseVaultAttachmentRef } from '../shared/vaultAttachments'

let tempRoot: string | null = null

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

async function newStore(
  options: ConstructorParameters<typeof VaultAttachmentStore>[1] = {},
): Promise<{ store: VaultAttachmentStore; directory: string }> {
  tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-attachments-'))
  const directory = join(tempRoot, 'attachments')
  return { store: new VaultAttachmentStore(directory, options), directory }
}

function attachment(text: string, mediaType = 'image/png'): { mediaType: string; bytes: Buffer } {
  return { mediaType, bytes: Buffer.from(text, 'utf8') }
}

describe('encrypted vault attachment store', () => {
  it('stores deterministic keyed references, encrypts privately, and deduplicates', async () => {
    const { store, directory } = await newStore()
    const key = randomVaultKey()
    const input = attachment('highly sensitive screenshot bytes')
    const expectedRef = createVaultAttachmentRef(key, input)

    const firstRef = await store.put(key, input)
    const secondRef = await store.put(key, input)
    const parsed = parseVaultAttachmentRef(firstRef)
    const file = join(directory, `${parsed.id}.blob`)
    const encrypted = await readFile(file)

    expect(firstRef).toBe(expectedRef)
    expect(secondRef).toBe(firstRef)
    expect(createVaultAttachmentRef(randomVaultKey(), input)).not.toBe(firstRef)
    expect(createVaultAttachmentRef(key, { ...input, mediaType: 'image/webp' })).not.toBe(firstRef)
    expect(await readdir(directory)).toEqual([`${parsed.id}.blob`])
    expect(encrypted.includes(input.bytes)).toBe(false)
    await expect(store.read(key, firstRef)).resolves.toEqual(input.bytes)
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(PRIVATE_DIR_MODE)
      expect((await stat(file)).mode & 0o777).toBe(PRIVATE_FILE_MODE)
    }
  })

  it('copies caller bytes before queued encryption and rejects wrong keys or tampering', async () => {
    const { store, directory } = await newStore()
    const key = randomVaultKey()
    const input = attachment('stable bytes')
    const expected = Buffer.from(input.bytes)
    const save = store.put(key, input)
    input.bytes.fill(0)
    const reference = await save

    await expect(store.read(key, reference)).resolves.toEqual(expected)
    await expect(store.read(randomVaultKey(), reference)).rejects.toMatchObject({ code: 'integrity' })

    const id = parseVaultAttachmentRef(reference).id
    const file = join(directory, `${id}.blob`)
    const encrypted = await readFile(file)
    encrypted[encrypted.length - 1] ^= 1
    await writeFile(file, encrypted)
    await expect(store.read(key, reference)).rejects.toMatchObject({ code: 'integrity' })
  })

  it('rejects link entries instead of following them', async () => {
    if (process.platform === 'win32') return
    const { store, directory } = await newStore()
    const key = randomVaultKey()
    const input = attachment('linked secret')
    const reference = createVaultAttachmentRef(key, input)
    const id = parseVaultAttachmentRef(reference).id
    await writeFile(join(tempRoot!, 'target'), 'not an encrypted attachment')
    await (await import('fs/promises')).mkdir(directory, { mode: 0o700 })
    await symlink(join(tempRoot!, 'target'), join(directory, `${id}.blob`))

    await expect(store.read(key, reference)).rejects.toMatchObject({ code: 'unsafe_file' })
    await expect(store.put(key, input)).rejects.toMatchObject({ code: 'unsafe_file' })
  })

  it('creates, cryptographically verifies, and restores exact backup blob maps', async () => {
    const { store } = await newStore()
    const key = randomVaultKey()
    const firstRef = await store.put(key, attachment('first image'))
    const secondRef = await store.put(key, attachment('second image', 'image/webp'))
    const blobs = await store.createBackupBlobMap(key, [firstRef, secondRef])

    expect(verifyVaultAttachmentBackupBlobMap(key, [firstRef, secondRef], blobs).count).toBe(2)
    const tampered = new Map(blobs)
    const firstId = parseVaultAttachmentRef(firstRef).id
    const secondId = parseVaultAttachmentRef(secondRef).id
    const swapped = new Map(blobs)
    swapped.set(firstId, blobs.get(secondId)!)
    swapped.set(secondId, blobs.get(firstId)!)
    expect(() => verifyVaultAttachmentBackupBlobMap(key, [firstRef, secondRef], swapped))
      .toThrow('integrity check failed')

    const changed = Buffer.from(tampered.get(firstId)!)
    changed[changed.length - 1] ^= 1
    tampered.set(firstId, changed)
    expect(() => verifyVaultAttachmentBackupBlobMap(key, [firstRef, secondRef], tampered))
      .toThrow('integrity check failed')

    const restoreRoot = join(tempRoot!, 'restored')
    const restored = new VaultAttachmentStore(restoreRoot)
    const restore = restored.restoreBackupBlobMap(key, [firstRef, secondRef], blobs)
    for (const blob of blobs.values()) blob.fill(0)
    await expect(restore)
      .resolves.toMatchObject({ count: 2 })
    await expect(restored.read(key, secondRef)).resolves.toEqual(Buffer.from('second image'))

    const restoredId = parseVaultAttachmentRef(secondRef).id
    const restoredFile = join(restoreRoot, `${restoredId}.blob`)
    const corrupted = await readFile(restoredFile)
    corrupted[corrupted.length - 1] ^= 1
    await writeFile(restoredFile, corrupted)
    const repairBlobs = await store.createBackupBlobMap(key, [firstRef, secondRef])
    await expect(restored.restoreBackupBlobMap(key, [firstRef, secondRef], repairBlobs))
      .resolves.toMatchObject({ count: 2 })
    await expect(restored.read(key, secondRef)).resolves.toEqual(Buffer.from('second image'))
  })

  it('enforces store file-count bounds without rescanning on every write', async () => {
    const { store } = await newStore({ maxCount: 1, maxDirectoryEntries: 2 })
    const key = randomVaultKey()

    await store.put(key, attachment('first'))
    await expect(store.put(key, attachment('second'))).rejects.toMatchObject({ code: 'count_limit' })
  })
})

describe('attachment orphan collection', () => {
  it('deletes only old unreferenced regular blobs and retains young or unknown entries', async () => {
    const { store, directory } = await newStore({ orphanGraceMs: 60 * 60 * 1_000 })
    const key = randomVaultKey()
    const keptRef = await store.put(key, attachment('referenced'))
    const oldOrphanRef = await store.put(key, attachment('old orphan'))
    const youngOrphanRef = await store.put(key, attachment('young orphan'))
    const nowMs = Date.now()
    const oldTime = new Date(nowMs - 2 * 60 * 60 * 1_000)
    const keptFile = join(directory, `${parseVaultAttachmentRef(keptRef).id}.blob`)
    const oldFile = join(directory, `${parseVaultAttachmentRef(oldOrphanRef).id}.blob`)
    const youngFile = join(directory, `${parseVaultAttachmentRef(youngOrphanRef).id}.blob`)
    await utimes(keptFile, oldTime, oldTime)
    await utimes(oldFile, oldTime, oldTime)
    await writeFile(join(directory, 'README.txt'), 'not managed by the store')
    if (process.platform !== 'win32') {
      await symlink(join(tempRoot!, 'missing-target'), join(directory, `${'f'.repeat(64)}.blob`))
    }

    const result = await store.garbageCollect([keptRef], { nowMs })

    expect(result.deleted).toBe(1)
    expect(result.retainedYoung).toBe(1)
    expect(result.retainedUnknown).toBe(process.platform === 'win32' ? 1 : 2)
    await expect(readFile(oldFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(keptFile)).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(youngFile)).resolves.toBeInstanceOf(Buffer)
  })
})
