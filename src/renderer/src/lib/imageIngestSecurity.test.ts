import { describe, expect, it, vi } from 'vitest'
import {
  ImageReadAttemptGate,
  MAX_IMAGE_INGEST_BYTES,
  isEditablePasteTarget,
  readBoundedImageDataUrl,
  selectImagePasteFile,
  validateImageIngestPreflight,
} from './imageIngestSecurity'

function candidate(type: string, bytes: number[]) {
  const data = Uint8Array.from(bytes)
  return {
    name: 'candidate',
    type,
    size: data.byteLength,
    slice: (start = 0, end = data.byteLength) => ({
      arrayBuffer: async () => data.slice(start, end).buffer,
    }),
  }
}

function dataUrl(type: string, bytes: number[]): string {
  return `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`
}

function uint16Be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function uint16Le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function uint24Le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
}

function uint32Be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function png(width: number, height: number): number[] {
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ...uint32Be(width), ...uint32Be(height),
  ]
}

function jpeg(width: number, height: number): number[] {
  return [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x07, 0x08,
    ...uint16Be(height), ...uint16Be(width),
  ]
}

function gif(width: number, height: number): number[] {
  return [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...uint16Le(width), ...uint16Le(height)]
}

function webp(width: number, height: number): number[] {
  return [
    0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
    0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ...uint24Le(width - 1), ...uint24Le(height - 1),
  ]
}

describe('image ingest security', () => {
  it('rejects unsupported MIME types and oversized files before reading', async () => {
    const reader = vi.fn(async () => '')
    const svg = candidate('image/svg+xml', [0x3c, 0x73, 0x76, 0x67])

    await expect(readBoundedImageDataUrl(svg, reader)).rejects.toThrow('PNG, JPEG, GIF, or WebP')
    expect(reader).not.toHaveBeenCalled()
    expect(validateImageIngestPreflight({ type: 'image/png', size: MAX_IMAGE_INGEST_BYTES + 1 }))
      .toContain('larger than')
  })

  it.each([
    ['image/png', png(640, 480)],
    ['image/jpeg', jpeg(640, 480)],
    ['image/gif', gif(640, 480)],
    ['image/webp', webp(640, 480)],
  ])('accepts a bounded %s file whose signature and data URL agree', async (type, bytes) => {
    const file = candidate(type, bytes)
    await expect(readBoundedImageDataUrl(file, async () => dataUrl(type, bytes)))
      .resolves.toBe(dataUrl(type, bytes))
  })

  it('rejects a spoofed MIME signature before FileReader runs', async () => {
    const reader = vi.fn(async () => dataUrl('image/png', [0x47, 0x49, 0x46]))
    const spoofed = candidate('image/png', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

    await expect(readBoundedImageDataUrl(spoofed, reader)).rejects.toThrow('do not match')
    expect(reader).not.toHaveBeenCalled()
  })

  it('rejects a data URL that changes MIME or byte length after preflight', async () => {
    const pngBytes = png(1, 1)
    const pngFile = candidate('image/png', pngBytes)

    await expect(readBoundedImageDataUrl(pngFile, async () => dataUrl('image/jpeg', jpeg(1, 1))))
      .rejects.toThrow('unexpected format')
    await expect(readBoundedImageDataUrl(pngFile, async () => dataUrl('image/png', pngBytes.slice(0, 8))))
      .rejects.toThrow('changed while')
  })

  it.each([
    ['image/png', png(8_193, 1)],
    ['image/jpeg', jpeg(4_097, 4_097)],
    ['image/gif', gif(1, 8_193)],
    ['image/webp', webp(4_097, 4_097)],
  ])('rejects excessive %s decoded dimensions before FileReader runs', async (type, bytes) => {
    const reader = vi.fn(async () => dataUrl(type, bytes))

    await expect(readBoundedImageDataUrl(candidate(type, bytes), reader))
      .rejects.toThrow('dimensions exceed')
    expect(reader).not.toHaveBeenCalled()
  })

  it('rejects malformed dimension metadata before FileReader runs', async () => {
    const reader = vi.fn(async () => '')
    const signatureOnly = candidate('image/png', png(1, 1).slice(0, 16))

    await expect(readBoundedImageDataUrl(signatureOnly, reader))
      .rejects.toThrow('safely validate')
    expect(reader).not.toHaveBeenCalled()
  })

  it('makes async reads single-writer and preserves text-field paste behavior', () => {
    const gate = new ImageReadAttemptGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
    gate.invalidate()
    expect(gate.isCurrent(second)).toBe(false)

    expect(isEditablePasteTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditablePasteTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true)
    expect(isEditablePasteTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isEditablePasteTarget({ tagName: 'div' } as unknown as EventTarget)).toBe(false)
    expect(isEditablePasteTarget({
      tagName: 'input',
      closest: () => ({ dataset: { imagePasteTarget: 'true' } }),
    } as unknown as EventTarget)).toBe(false)
  })

  it('accepts only a supported, bounded image without consuming editable-target paste', () => {
    const pngFile = candidate('image/png', png(1, 1))
    const items = [{ type: pngFile.type, getAsFile: () => pngFile }]

    expect(selectImagePasteFile({ tagName: 'input' } as unknown as EventTarget, items))
      .toEqual({ status: 'ignore' })
    expect(selectImagePasteFile(null, items)).toEqual({ status: 'accept', file: pngFile })
    expect(selectImagePasteFile(null, [{
      type: 'image/svg+xml',
      getAsFile: () => candidate('image/svg+xml', [0x3c]),
    }])).toEqual({ status: 'reject', error: 'Choose a PNG, JPEG, GIF, or WebP image' })
    expect(selectImagePasteFile(null, [{
      type: 'image/png',
      getAsFile: () => ({ ...pngFile, size: MAX_IMAGE_INGEST_BYTES + 1 }),
    }])).toMatchObject({ status: 'reject' })
  })
})
