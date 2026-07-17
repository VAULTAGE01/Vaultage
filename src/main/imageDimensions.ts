import { Buffer } from 'buffer'

export type SupportedImageFormat = 'png' | 'jpg' | 'gif' | 'webp'

export const IMAGE_DIMENSION_LIMITS = Object.freeze({
  maxAxis: 8_192,
  maxPixels: 16_777_216,
})

export function assertSafeImageDimensions(
  bytes: Buffer,
  format: SupportedImageFormat,
): { width: number; height: number } {
  const dimensions = parseImageDimensions(bytes, format)
  const { width, height } = dimensions
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions are invalid')
  }
  if (width > IMAGE_DIMENSION_LIMITS.maxAxis || height > IMAGE_DIMENSION_LIMITS.maxAxis) {
    throw new Error(`Image dimensions exceed ${IMAGE_DIMENSION_LIMITS.maxAxis}px per axis`)
  }
  if (width * height > IMAGE_DIMENSION_LIMITS.maxPixels) {
    throw new Error(`Image dimensions exceed ${IMAGE_DIMENSION_LIMITS.maxPixels} pixels`)
  }
  return dimensions
}

function parseImageDimensions(bytes: Buffer, format: SupportedImageFormat): { width: number; height: number } {
  switch (format) {
    case 'png':
      return parsePngDimensions(bytes)
    case 'jpg':
      return parseJpegDimensions(bytes)
    case 'gif':
      return parseGifDimensions(bytes)
    case 'webp':
      return parseWebpDimensions(bytes)
  }
}

function parsePngDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error('PNG dimensions are invalid')
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function parseGifDimensions(bytes: Buffer): { width: number; height: number } {
  const header = bytes.length >= 6 ? bytes.subarray(0, 6).toString('ascii') : ''
  if (bytes.length < 10 || (header !== 'GIF87a' && header !== 'GIF89a')) {
    throw new Error('GIF dimensions are invalid')
  }
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
}

function parseJpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('JPEG dimensions are invalid')
  }

  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('JPEG dimensions are invalid')
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break

    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00) throw new Error('JPEG dimensions are invalid')
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) throw new Error('JPEG dimensions are invalid')

    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error('JPEG dimensions are invalid')
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 8) throw new Error('JPEG dimensions are invalid')
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      }
    }
    offset += segmentLength
  }

  throw new Error('JPEG dimensions are invalid')
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

function parseWebpDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('WebP dimensions are invalid')
  }

  const chunkType = bytes.subarray(12, 16).toString('ascii')
  const chunkLength = bytes.readUInt32LE(16)
  const availablePayload = bytes.length - 20
  if (chunkLength > availablePayload) throw new Error('WebP dimensions are invalid')

  if (chunkType === 'VP8X') {
    if (chunkLength < 10) throw new Error('WebP dimensions are invalid')
    return {
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    }
  }
  if (chunkType === 'VP8 ') {
    if (
      chunkLength < 10 ||
      (bytes[20] & 0x01) !== 0 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      throw new Error('WebP dimensions are invalid')
    }
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    }
  }
  if (chunkType === 'VP8L') {
    if (chunkLength < 5 || bytes[20] !== 0x2f) throw new Error('WebP dimensions are invalid')
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    }
  }

  throw new Error('WebP dimensions are invalid')
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
}
