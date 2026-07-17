import { VAULT_VALIDATION_LIMITS } from '../../../shared/vaultValidation'

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const

export type SupportedImageMimeType = typeof SUPPORTED_IMAGE_MIME_TYPES[number]

const SUPPORTED_IMAGE_MIME_SET = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES)
export const MAX_IMAGE_INGEST_BYTES = VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes
export const MAX_IMAGE_AXIS_PIXELS = 8_192
export const MAX_IMAGE_TOTAL_PIXELS = 16_777_216

// JPEG permits metadata segments before its frame header. Bound the scan so a
// crafted file cannot make dimension validation allocate the entire payload.
const MAX_IMAGE_METADATA_SCAN_BYTES = 1024 * 1024

export interface ImageIngestFile {
  readonly name: string
  readonly size: number
  readonly type: string
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export interface ClipboardImageItem<T extends ImageIngestFile> {
  readonly type: string
  getAsFile(): T | null
}

export type ImagePasteSelection<T extends ImageIngestFile> =
  | { status: 'ignore' }
  | { status: 'reject'; error: string }
  | { status: 'accept'; file: T }

export function normalizedSupportedImageMimeType(type: string): SupportedImageMimeType | null {
  const normalized = type.trim().toLowerCase()
  return SUPPORTED_IMAGE_MIME_SET.has(normalized)
    ? normalized as SupportedImageMimeType
    : null
}

/**
 * Synchronous preflight that must run before FileReader allocates a base64
 * copy. The canonical vault validator repeats the byte limit at persistence.
 */
export function validateImageIngestPreflight(file: Pick<ImageIngestFile, 'size' | 'type'>): string | null {
  if (!normalizedSupportedImageMimeType(file.type)) {
    return 'Choose a PNG, JPEG, GIF, or WebP image'
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    return 'The selected image is empty or has an invalid size'
  }
  if (file.size > MAX_IMAGE_INGEST_BYTES) {
    return `The selected image is larger than ${formatMiB(MAX_IMAGE_INGEST_BYTES)} MB`
  }
  return null
}

export async function readBoundedImageDataUrl<T extends ImageIngestFile>(
  file: T,
  readDataUrl: (file: T) => Promise<string>,
): Promise<string> {
  const preflightError = validateImageIngestPreflight(file)
  if (preflightError) throw new Error(preflightError)

  const mimeType = normalizedSupportedImageMimeType(file.type)!
  const header = new Uint8Array(await file.slice(
    0,
    Math.min(file.size, MAX_IMAGE_METADATA_SCAN_BYTES),
  ).arrayBuffer())
  if (!matchesImageSignature(mimeType, header)) {
    throw new Error('The selected file contents do not match its image type')
  }
  validateImageDimensions(mimeType, header)

  const dataUrl = await readDataUrl(file)
  validateReadDataUrl(dataUrl, mimeType, file.size)
  return dataUrl
}

/** Single-writer guard for asynchronous FileReader work. */
export class ImageReadAttemptGate {
  private generation = 0

  begin(): number {
    return ++this.generation
  }

  invalidate(): void {
    this.generation++
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation
  }
}

/**
 * A window-level image paste handler must not consume text intended for an
 * input, textarea, or contenteditable element. An explicit image paste target
 * can opt in via data-image-paste-target="true".
 */
export function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const candidate = target as {
    tagName?: unknown
    isContentEditable?: unknown
    closest?: (selector: string) => unknown
  }
  if (candidate.closest?.('[data-image-paste-target="true"]')) return false
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toLowerCase() : ''
  return tagName === 'input' || tagName === 'textarea' || candidate.isContentEditable === true
}

/**
 * Pure clipboard selection step. Callers only preventDefault for `accept`, so
 * rejected or unrelated clipboard content retains normal paste behavior.
 */
export function selectImagePasteFile<T extends ImageIngestFile>(
  target: EventTarget | null,
  items: readonly ClipboardImageItem<T>[],
): ImagePasteSelection<T> {
  if (isEditablePasteTarget(target)) return { status: 'ignore' }
  const imageItems = items.filter(item => item.type.toLowerCase().startsWith('image/'))
  const supportedItem = imageItems.find(item => normalizedSupportedImageMimeType(item.type))
  if (!supportedItem) {
    return imageItems.length > 0
      ? { status: 'reject', error: 'Choose a PNG, JPEG, GIF, or WebP image' }
      : { status: 'ignore' }
  }
  const file = supportedItem.getAsFile()
  if (!file) return { status: 'reject', error: 'Could not read image from the clipboard' }
  const error = validateImageIngestPreflight(file)
  return error ? { status: 'reject', error } : { status: 'accept', file }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read image'))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.onabort = () => reject(new Error('Image read was cancelled'))
    reader.readAsDataURL(file)
  })
}

function matchesImageSignature(mimeType: SupportedImageMimeType, bytes: Uint8Array): boolean {
  if (mimeType === 'image/png') {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff])
  if (mimeType === 'image/gif') {
    return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a'
  }
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
}

function validateImageDimensions(mimeType: SupportedImageMimeType, bytes: Uint8Array): void {
  const dimensions = readImageDimensions(mimeType, bytes)
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error('Could not safely validate the selected image dimensions')
  }
  if (
    dimensions.width > MAX_IMAGE_AXIS_PIXELS
    || dimensions.height > MAX_IMAGE_AXIS_PIXELS
    || dimensions.width * dimensions.height > MAX_IMAGE_TOTAL_PIXELS
  ) {
    throw new Error(
      `The selected image dimensions exceed ${MAX_IMAGE_AXIS_PIXELS}px per side or ${MAX_IMAGE_TOTAL_PIXELS.toLocaleString()} total pixels`,
    )
  }
}

function readImageDimensions(
  mimeType: SupportedImageMimeType,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (mimeType === 'image/png') return readPngDimensions(bytes)
  if (mimeType === 'image/jpeg') return readJpegDimensions(bytes)
  if (mimeType === 'image/gif') return readGifDimensions(bytes)
  return readWebpDimensions(bytes)
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || readUint32Be(bytes, 8) !== 13 || ascii(bytes, 12, 16) !== 'IHDR') return null
  return { width: readUint32Be(bytes, 16), height: readUint32Be(bytes, 20) }
}

function readGifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null
  return { width: readUint16Le(bytes, 6), height: readUint16Le(bytes, 8) }
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) return null

    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return null
    // Standalone markers do not carry segment lengths.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null

    const segmentLength = readUint16Be(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null
      return {
        height: readUint16Be(bytes, offset + 3),
        width: readUint16Be(bytes, offset + 5),
      }
    }
    offset += segmentLength
  }
  return null
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf
    && marker !== 0xc4
    && marker !== 0xc8
    && marker !== 0xcc
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20) return null
  const chunkType = ascii(bytes, 12, 16)
  if (chunkType === 'VP8X') {
    if (bytes.length < 30) return null
    return {
      width: 1 + readUint24Le(bytes, 24),
      height: 1 + readUint24Le(bytes, 27),
    }
  }
  if (chunkType === 'VP8 ') {
    if (
      bytes.length < 30
      || (bytes[20] & 0x01) !== 0
      || bytes[23] !== 0x9d
      || bytes[24] !== 0x01
      || bytes[25] !== 0x2a
    ) return null
    return {
      width: readUint16Le(bytes, 26) & 0x3fff,
      height: readUint16Le(bytes, 28) & 0x3fff,
    }
  }
  if (chunkType === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    }
  }
  return null
}

function validateReadDataUrl(dataUrl: string, mimeType: SupportedImageMimeType, fileSize: number): void {
  const prefix = `data:${mimeType};base64,`
  if (!dataUrl.startsWith(prefix)) throw new Error('The image reader returned an unexpected format')
  const base64 = dataUrl.slice(prefix.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('The image reader returned invalid data')
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor(base64.length * 3 / 4) - padding
  if (decodedBytes !== fileSize || decodedBytes > MAX_IMAGE_INGEST_BYTES) {
    throw new Error('The image changed while it was being read')
  }
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value)
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return Array.from(bytes.slice(start, end), byte => String.fromCharCode(byte)).join('')
}

function formatMiB(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}
