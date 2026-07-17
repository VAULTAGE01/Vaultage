import { describe, expect, it, vi } from 'vitest'
import {
  VAULT_ATTACHMENT_REF_PREFIX,
  VAULT_ATTACHMENT_SCHEME_PREFIX,
  VaultAttachmentError,
  collectVaultAttachmentRefs,
  externalizeVaultImageDataUrls,
  formatVaultAttachmentRef,
  isVaultAttachmentRef,
  parseImageDataUrl,
  parseVaultAttachmentRef,
  resolveVaultImageValue,
  verifyVaultAttachmentBlobMap,
} from './vaultAttachments'

const FIRST_ID = 'a'.repeat(64)
const SECOND_ID = '2'.repeat(64)
const FIRST_REF = formatVaultAttachmentRef(FIRST_ID, 'image/png')
const SECOND_REF = formatVaultAttachmentRef(SECOND_ID, 'image/webp')

function imageSecret(id: string, value: string, media = 'image'): Record<string, unknown> {
  return {
    id,
    name: id,
    type: media,
    fields: [{ key: '__image__', value, sensitive: true }],
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function vaultWithImages(...values: string[]): Record<string, unknown> {
  return {
    version: 2,
    root: {
      id: 'root',
      name: 'Root',
      secrets: values.slice(0, 1).map((value, index) => imageSecret(`image-${index}`, value)),
      children: [{
        id: 'nested',
        name: 'Nested',
        secrets: values.slice(1).map((value, index) => imageSecret(`nested-image-${index}`, value)),
        children: [],
      }],
    },
    providers: [],
    envProjects: [],
  }
}

describe('vault attachment references', () => {
  it('formats and parses only canonical, traversal-proof references', () => {
    expect(parseVaultAttachmentRef(FIRST_REF)).toEqual({
      version: 1,
      id: FIRST_ID,
      mediaType: 'image/png',
      value: FIRST_REF,
    })
    expect(isVaultAttachmentRef(FIRST_REF)).toBe(true)

    for (const invalid of [
      `${VAULT_ATTACHMENT_REF_PREFIX}${FIRST_ID.toUpperCase()}:image/png`,
      `${FIRST_REF}/../secret`,
      `${FIRST_REF}?file=other`,
      `${VAULT_ATTACHMENT_REF_PREFIX}${FIRST_ID}:Image/PNG`,
      `vaultage-attachment:v2:${FIRST_ID}:image/png`,
      `${VAULT_ATTACHMENT_REF_PREFIX}../${FIRST_ID}:image/png`,
    ]) {
      expect(() => parseVaultAttachmentRef(invalid)).toThrow(VaultAttachmentError)
      expect(isVaultAttachmentRef(invalid)).toBe(false)
    }
  })

  it('decodes bounded image data URLs and normalizes media-type case', () => {
    const parsed = parseImageDataUrl('data:IMAGE/PNG;base64,c2Vj\ncmV0')

    expect(parsed.mediaType).toBe('image/png')
    expect(new TextDecoder().decode(parsed.bytes)).toBe('secret')
    expect(() => parseImageDataUrl('data:image/png;base64,not_base64!')).toThrow('base64 data URL')
    expect(() => parseImageDataUrl('data:text/plain;base64,c2VjcmV0')).toThrow('base64 data URL')
  })
})

describe('vault image attachment transformations', () => {
  it('externalizes nested data URLs immutably and collects unique references', async () => {
    const firstDataUrl = 'data:image/png;base64,cG5nLWJ5dGVz'
    const secondDataUrl = 'data:image/webp;base64,d2VicC1ieXRlcw=='
    const original = vaultWithImages(firstDataUrl, secondDataUrl, FIRST_REF)
    const writes: { mediaType: string; bytes: Uint8Array }[] = []

    const result = await externalizeVaultImageDataUrls(original, async input => {
      writes.push({ mediaType: input.mediaType, bytes: Uint8Array.from(input.bytes) })
      return input.mediaType === 'image/png' ? FIRST_REF : SECOND_REF
    })

    expect(result.externalizedCount).toBe(2)
    expect(result.externalizedBytes).toBe(19)
    expect(writes.map(item => [item.mediaType, new TextDecoder().decode(item.bytes)])).toEqual([
      ['image/png', 'png-bytes'],
      ['image/webp', 'webp-bytes'],
    ])
    expect(result.references).toEqual(new Map([
      [FIRST_ID, parseVaultAttachmentRef(FIRST_REF)],
      [SECOND_ID, parseVaultAttachmentRef(SECOND_REF)],
    ]))

    const originalRoot = original.root as Record<string, unknown>
    const originalFirst = (originalRoot.secrets as Record<string, unknown>[])[0]
    expect((originalFirst.fields as Record<string, unknown>[])[0].value).toBe(firstDataUrl)
    expect(result.vault).not.toBe(original)
    expect(collectVaultAttachmentRefs(result.vault)).toEqual(result.references)
  })

  it('enforces pre-write count and byte limits', async () => {
    const vault = vaultWithImages(
      'data:image/png;base64,AAAA',
      'data:image/png;base64,AAAA',
    )
    const writer = vi.fn(async () => FIRST_REF)

    await expect(externalizeVaultImageDataUrls(vault, writer, { maxCount: 1 }))
      .rejects.toMatchObject({ code: 'count_limit' })
    expect(writer).not.toHaveBeenCalled()

    await expect(externalizeVaultImageDataUrls(vault, writer, { maxAggregatePlaintextBytes: 5 }))
      .rejects.toMatchObject({ code: 'aggregate_size_limit' })
    expect(writer).not.toHaveBeenCalled()
  })

  it('resolves references lazily and leaves ordinary values untouched', async () => {
    const load = vi.fn(async () => new TextEncoder().encode('png-bytes'))

    await expect(resolveVaultImageValue('data:image/png;base64,AAAA', load))
      .resolves.toBe('data:image/png;base64,AAAA')
    expect(load).not.toHaveBeenCalled()

    await expect(resolveVaultImageValue(FIRST_REF, load))
      .resolves.toBe('data:image/png;base64,cG5nLWJ5dGVz')
    expect(load).toHaveBeenCalledWith(parseVaultAttachmentRef(FIRST_REF))

    await expect(resolveVaultImageValue(`${VAULT_ATTACHMENT_SCHEME_PREFIX}v2:${FIRST_ID}:image/png`, load))
      .rejects.toMatchObject({ code: 'invalid_ref' })
    expect(() => collectVaultAttachmentRefs(
      vaultWithImages(`${VAULT_ATTACHMENT_SCHEME_PREFIX}v2:${FIRST_ID}:image/png`),
    )).toThrow(VaultAttachmentError)
  })
})

describe('attachment backup blob-map structure', () => {
  it('requires an exact bounded mapping from reference IDs to encrypted blobs', () => {
    const blobs = new Map<string, Uint8Array>([
      [FIRST_ID, new Uint8Array(32)],
      [SECOND_ID, new Uint8Array(40)],
    ])

    expect(verifyVaultAttachmentBlobMap([FIRST_REF, SECOND_REF], blobs)).toEqual({
      count: 2,
      encryptedBytes: 72,
    })
    expect(() => verifyVaultAttachmentBlobMap([FIRST_REF], blobs))
      .toThrow('blob count does not match')
    expect(() => verifyVaultAttachmentBlobMap(
      [FIRST_REF],
      new Map([[SECOND_ID, new Uint8Array(32)]]),
    )).toThrow('unexpected attachment blob')
    expect(() => verifyVaultAttachmentBlobMap(
      [FIRST_REF],
      new Map([[FIRST_ID, new Uint8Array(28)]]),
    )).toThrow('outside the supported size range')
  })
})
