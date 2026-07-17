import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'
import { assertSafeImageDimensions } from './imageDimensions'

describe('assertSafeImageDimensions', () => {
  it.each([
    ['PNG', png(640, 480), 'png', 640, 480],
    ['JPEG', jpeg(1024, 768), 'jpg', 1024, 768],
    ['GIF', gif(320, 240), 'gif', 320, 240],
    ['extended WebP', webpExtended(800, 600), 'webp', 800, 600],
    ['lossy WebP', webpLossy(1280, 720), 'webp', 1280, 720],
    ['lossless WebP', webpLossless(4096, 4096), 'webp', 4096, 4096],
  ] as const)('accepts valid %s dimensions', (_, bytes, format, width, height) => {
    expect(assertSafeImageDimensions(bytes, format)).toEqual({ width, height })
  })

  it('rejects zero dimensions', () => {
    expect(() => assertSafeImageDimensions(png(0, 10), 'png')).toThrow('dimensions are invalid')
  })

  it('rejects malformed image headers', () => {
    expect(() => assertSafeImageDimensions(Buffer.from('not an image'), 'jpg')).toThrow('JPEG dimensions are invalid')
    expect(() => assertSafeImageDimensions(truncatedWebp(), 'webp')).toThrow('WebP dimensions are invalid')
  })

  it('rejects dimensions above the per-axis limit', () => {
    expect(() => assertSafeImageDimensions(png(8_193, 1), 'png')).toThrow('exceed 8192px per axis')
  })

  it('rejects dimensions above the decoded-pixel limit', () => {
    expect(() => assertSafeImageDimensions(png(4_097, 4_096), 'png')).toThrow('exceed 16777216 pixels')
  })
})

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(10)
  bytes.write('GIF89a', 0, 'ascii')
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  return bytes
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc2, 0x00, 0x08, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01,
    0xff, 0xd9,
  ])
}

function webpExtended(width: number, height: number): Buffer {
  const bytes = webpContainer('VP8X', 10)
  writeUInt24LE(bytes, 24, width - 1)
  writeUInt24LE(bytes, 27, height - 1)
  return bytes
}

function webpLossy(width: number, height: number): Buffer {
  const bytes = webpContainer('VP8 ', 10)
  bytes[20] = 0
  bytes[23] = 0x9d
  bytes[24] = 0x01
  bytes[25] = 0x2a
  bytes.writeUInt16LE(width, 26)
  bytes.writeUInt16LE(height, 28)
  return bytes
}

function webpLossless(width: number, height: number): Buffer {
  const bytes = webpContainer('VP8L', 5)
  const widthMinusOne = width - 1
  const heightMinusOne = height - 1
  bytes[20] = 0x2f
  bytes[21] = widthMinusOne & 0xff
  bytes[22] = ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6)
  bytes[23] = (heightMinusOne >> 2) & 0xff
  bytes[24] = (heightMinusOne >> 10) & 0x0f
  return bytes
}

function webpContainer(chunkType: string, chunkLength: number): Buffer {
  const bytes = Buffer.alloc(20 + chunkLength)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WEBP', 8, 'ascii')
  bytes.write(chunkType, 12, 'ascii')
  bytes.writeUInt32LE(chunkLength, 16)
  return bytes
}

function truncatedWebp(): Buffer {
  const bytes = webpContainer('VP8X', 2)
  bytes.writeUInt32LE(10, 16)
  return bytes
}

function writeUInt24LE(bytes: Buffer, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
  bytes[offset + 2] = (value >> 16) & 0xff
}
