import { REDACTED_SECRET_VALUE } from './vaultRedaction'
import { VAULT_VALIDATION_LIMITS } from './vaultValidation'

export const VAULT_ATTACHMENT_SCHEME_PREFIX = 'vaultage-attachment:'
export const VAULT_ATTACHMENT_REF_PREFIX = `${VAULT_ATTACHMENT_SCHEME_PREFIX}v1:`
export const VAULT_ATTACHMENT_ENVELOPE_BYTES = 28

/**
 * Attachment limits are derived from the canonical vault limits. External
 * storage removes image bytes from the JSON document, but it does not permit a
 * single image (or the number of image secrets) to bypass the existing bounds.
 */
export const VAULT_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: VAULT_VALIDATION_LIMITS.maxSecrets,
  maxPlaintextBytes: VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes,
  maxAggregatePlaintextBytes: VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytesAggregate,
  maxEncryptedBlobBytes:
    VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes + VAULT_ATTACHMENT_ENVELOPE_BYTES,
  maxAggregateEncryptedBytes:
    (VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes + VAULT_ATTACHMENT_ENVELOPE_BYTES)
      * VAULT_VALIDATION_LIMITS.maxSecrets,
})

export interface VaultAttachmentReference {
  version: 1
  id: string
  mediaType: string
  value: string
}

export interface VaultAttachmentInput {
  mediaType: string
  bytes: Uint8Array
}

export interface VaultAttachmentExternalizeResult<T> {
  vault: T
  references: Map<string, VaultAttachmentReference>
  externalizedCount: number
  externalizedBytes: number
}

export interface VaultAttachmentBlobSummary {
  count: number
  encryptedBytes: number
}

export interface VaultAttachmentBlobLimits {
  maxCount?: number
  maxEncryptedBlobBytes?: number
  maxAggregateEncryptedBytes?: number
}

export class VaultAttachmentError extends Error {
  readonly name = 'VaultAttachmentError'

  constructor(
    readonly code: string,
    requirement: string,
  ) {
    super(`Invalid vault attachment: ${requirement}`)
  }
}

const ATTACHMENT_ID_RE = /^[0-9a-f]{64}$/
const IMAGE_MEDIA_TYPE_RE = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/
const ATTACHMENT_REF_RE = /^vaultage-attachment:v1:([0-9a-f]{64}):(image\/[a-z0-9][a-z0-9.+-]{0,63})$/
const IMAGE_DATA_URL_RE = /^data:(image\/[a-z0-9][a-z0-9.+-]{0,63});base64,([a-z0-9+/= \t\r\n]+)$/i

export function isVaultAttachmentRef(value: string): boolean {
  return ATTACHMENT_REF_RE.test(value)
}

export function parseVaultAttachmentRef(value: string): VaultAttachmentReference {
  const match = ATTACHMENT_REF_RE.exec(value)
  if (!match) {
    throw new VaultAttachmentError('invalid_ref', 'reference must use the canonical v1 format')
  }
  return { version: 1, id: match[1], mediaType: match[2], value }
}

export function formatVaultAttachmentRef(id: string, mediaType: string): string {
  if (!ATTACHMENT_ID_RE.test(id)) {
    throw new VaultAttachmentError('invalid_id', 'identifier must be 64 lowercase hexadecimal characters')
  }
  if (!IMAGE_MEDIA_TYPE_RE.test(mediaType)) {
    throw new VaultAttachmentError('invalid_media_type', 'media type must be a canonical lowercase image type')
  }
  return `${VAULT_ATTACHMENT_REF_PREFIX}${id}:${mediaType}`
}

export function parseImageDataUrl(value: string): VaultAttachmentInput {
  const match = IMAGE_DATA_URL_RE.exec(value)
  if (!match) {
    throw new VaultAttachmentError('invalid_data_url', 'image must be a base64 data URL')
  }
  const base64 = match[2].replace(/[ \t\r\n]+/g, '')
  if (!isCanonicalBase64(base64)) {
    throw new VaultAttachmentError('invalid_base64', 'image contains invalid base64 data')
  }
  const byteLength = decodedBase64Bytes(base64)
  if (byteLength < 1 || byteLength > VAULT_ATTACHMENT_LIMITS.maxPlaintextBytes) {
    throw new VaultAttachmentError('size_limit', 'image is outside the supported size range')
  }

  let bytes: Uint8Array
  try {
    const binary = atob(base64)
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    throw new VaultAttachmentError('invalid_base64', 'image contains invalid base64 data')
  }
  if (bytes.byteLength !== byteLength) {
    throw new VaultAttachmentError('invalid_base64', 'image contains invalid base64 data')
  }
  return { mediaType: match[1].toLowerCase(), bytes }
}

/**
 * Replaces embedded image data URLs without mutating the supplied VaultRoot.
 * The writer may leave unreachable content-addressed blobs behind if a later
 * write fails; the age-gated orphan collector is responsible for those. Input
 * bytes are ephemeral and are zeroed after each awaited writer completes.
 */
export async function externalizeVaultImageDataUrls<T>(
  vault: T,
  writeAttachment: (input: VaultAttachmentInput) => Promise<string>,
  options: {
    maxCount?: number
    maxAggregatePlaintextBytes?: number
  } = {},
): Promise<VaultAttachmentExternalizeResult<T>> {
  const maxCount = boundedLimit(options.maxCount, VAULT_ATTACHMENT_LIMITS.maxCount, 'attachment count')
  const maxAggregatePlaintextBytes = boundedLimit(
    options.maxAggregatePlaintextBytes,
    VAULT_ATTACHMENT_LIMITS.maxAggregatePlaintextBytes,
    'aggregate attachment bytes',
  )
  const fields = imageFields(vault)
  if (fields.length > maxCount) {
    throw new VaultAttachmentError('count_limit', 'vault contains too many image attachments')
  }

  const pending: { field: Record<string, unknown>; input: VaultAttachmentInput }[] = []
  let externalizedBytes = 0
  try {
    for (const field of fields) {
      const value = field.value
      if (typeof value !== 'string') {
        throw new VaultAttachmentError('invalid_vault', 'image field value must be text')
      }
      if (value === '' || value === REDACTED_SECRET_VALUE) continue
      if (value.startsWith(VAULT_ATTACHMENT_SCHEME_PREFIX)) {
        parseVaultAttachmentRef(value)
        continue
      }

      const input = parseImageDataUrl(value)
      externalizedBytes += input.bytes.byteLength
      if (externalizedBytes > maxAggregatePlaintextBytes) {
        input.bytes.fill(0)
        throw new VaultAttachmentError('aggregate_size_limit', 'vault attachments exceed the aggregate byte limit')
      }
      pending.push({ field, input })
    }
  } catch (error) {
    for (const item of pending) item.input.bytes.fill(0)
    throw error
  }

  const replacements = new Map<Record<string, unknown>, string>()
  try {
    for (const item of pending) {
      const value = await writeAttachment(item.input)
      const reference = parseVaultAttachmentRef(value)
      if (reference.mediaType !== item.input.mediaType) {
        throw new VaultAttachmentError('media_type_mismatch', 'stored reference media type does not match its image')
      }
      replacements.set(item.field, value)
    }
  } finally {
    for (const item of pending) item.input.bytes.fill(0)
  }

  const rewritten = cloneVaultWithImageFieldReplacements(vault, replacements)
  return {
    vault: rewritten,
    references: collectVaultAttachmentRefs(rewritten, { maxCount }),
    externalizedCount: pending.length,
    externalizedBytes,
  }
}

/** Resolve one image value on demand. Non-reference values do not call load. */
export async function resolveVaultImageValue(
  value: string,
  load: (reference: VaultAttachmentReference) => Promise<Uint8Array>,
): Promise<string> {
  if (!value.startsWith(VAULT_ATTACHMENT_SCHEME_PREFIX)) return value
  const reference = parseVaultAttachmentRef(value)
  const bytes = await load(reference)
  if (!(bytes instanceof Uint8Array)) {
    throw new VaultAttachmentError('invalid_blob', 'attachment loader must return bytes')
  }
  if (bytes.byteLength < 1 || bytes.byteLength > VAULT_ATTACHMENT_LIMITS.maxPlaintextBytes) {
    throw new VaultAttachmentError('size_limit', 'loaded image is outside the supported size range')
  }
  return `data:${reference.mediaType};base64,${bytesToBase64(bytes)}`
}

/**
 * Hydrates every authenticated attachment reference into the renderer-facing
 * data-URL representation without mutating the persisted vault object. Loaded
 * plaintext is cleared after it has been encoded.
 */
export async function hydrateVaultImageAttachments<T>(
  vault: T,
  load: (reference: VaultAttachmentReference) => Promise<Uint8Array>,
): Promise<T> {
  const replacements = new Map<Record<string, unknown>, string>()
  for (const field of imageFields(vault)) {
    const value = field.value
    if (typeof value !== 'string' || !value.startsWith(VAULT_ATTACHMENT_SCHEME_PREFIX)) continue
    const reference = parseVaultAttachmentRef(value)
    const bytes = await load(reference)
    try {
      replacements.set(field, await resolveVaultImageValue(value, async () => bytes))
    } finally {
      bytes.fill(0)
    }
  }
  return cloneVaultWithImageFieldReplacements(vault, replacements)
}

export function collectVaultAttachmentRefs(
  vault: unknown,
  options: { maxCount?: number } = {},
): Map<string, VaultAttachmentReference> {
  const maxCount = boundedLimit(options.maxCount, VAULT_ATTACHMENT_LIMITS.maxCount, 'attachment count')
  const references = new Map<string, VaultAttachmentReference>()
  for (const field of imageFields(vault)) {
    const value = field.value
    if (typeof value !== 'string' || !value.startsWith(VAULT_ATTACHMENT_SCHEME_PREFIX)) continue
    const reference = parseVaultAttachmentRef(value)
    const current = references.get(reference.id)
    if (current && current.mediaType !== reference.mediaType) {
      throw new VaultAttachmentError('id_collision', 'one identifier is associated with multiple media types')
    }
    references.set(reference.id, reference)
    if (references.size > maxCount) {
      throw new VaultAttachmentError('count_limit', 'vault contains too many attachment references')
    }
  }
  return references
}

/**
 * Checks that a backup blob map is an exact, bounded match for its references.
 * Cryptographic verification is performed by the main-process store because
 * it requires the vault key.
 */
export function verifyVaultAttachmentBlobMap(
  references: Iterable<string | VaultAttachmentReference>,
  blobs: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
  options: VaultAttachmentBlobLimits = {},
): VaultAttachmentBlobSummary {
  const maxCount = boundedLimit(options.maxCount, VAULT_ATTACHMENT_LIMITS.maxCount, 'attachment count')
  const maxEncryptedBlobBytes = boundedLimit(
    options.maxEncryptedBlobBytes,
    VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes,
    'encrypted attachment bytes',
  )
  const maxAggregateEncryptedBytes = boundedLimit(
    options.maxAggregateEncryptedBytes,
    VAULT_ATTACHMENT_LIMITS.maxAggregateEncryptedBytes,
    'aggregate encrypted attachment bytes',
  )
  const expected = new Map<string, VaultAttachmentReference>()
  for (const raw of references) {
    const reference = typeof raw === 'string' ? parseVaultAttachmentRef(raw) : parseVaultAttachmentRef(raw.value)
    if (
      typeof raw !== 'string' &&
      (raw.version !== reference.version || raw.id !== reference.id || raw.mediaType !== reference.mediaType)
    ) {
      throw new VaultAttachmentError('invalid_ref', 'reference fields do not match its canonical value')
    }
    const current = expected.get(reference.id)
    if (current && current.mediaType !== reference.mediaType) {
      throw new VaultAttachmentError('id_collision', 'one identifier is associated with multiple media types')
    }
    expected.set(reference.id, reference)
    if (expected.size > maxCount) {
      throw new VaultAttachmentError('count_limit', 'backup contains too many attachment references')
    }
  }

  const entries = blobs instanceof Map ? [...blobs.entries()] : Object.entries(blobs)
  if (entries.length !== expected.size) {
    throw new VaultAttachmentError('blob_map_mismatch', 'backup blob count does not match its references')
  }
  let encryptedBytes = 0
  const seen = new Set<string>()
  for (const [id, value] of entries) {
    if (!ATTACHMENT_ID_RE.test(id) || !expected.has(id) || seen.has(id)) {
      throw new VaultAttachmentError('blob_map_mismatch', 'backup contains an unexpected attachment blob')
    }
    if (!(value instanceof Uint8Array)) {
      throw new VaultAttachmentError('invalid_blob', 'backup attachment must contain bytes')
    }
    if (value.byteLength <= VAULT_ATTACHMENT_ENVELOPE_BYTES || value.byteLength > maxEncryptedBlobBytes) {
      throw new VaultAttachmentError('size_limit', 'encrypted attachment is outside the supported size range')
    }
    encryptedBytes += value.byteLength
    if (encryptedBytes > maxAggregateEncryptedBytes) {
      throw new VaultAttachmentError('aggregate_size_limit', 'backup attachments exceed the aggregate byte limit')
    }
    seen.add(id)
  }
  return { count: entries.length, encryptedBytes }
}

function imageFields(vault: unknown): Record<string, unknown>[] {
  const root = requireRecord(vault)
  const firstFolder = requireRecord(root.root)
  const pending: { folder: Record<string, unknown>; depth: number }[] = [
    { folder: firstFolder, depth: 0 },
  ]
  const visited = new WeakSet<object>()
  const result: Record<string, unknown>[] = []
  let folderCount = 0

  while (pending.length > 0) {
    const { folder, depth } = pending.pop()!
    if (visited.has(folder) || depth > VAULT_VALIDATION_LIMITS.maxFolderDepth) {
      throw new VaultAttachmentError('invalid_vault', 'folder tree is cyclic or too deep')
    }
    visited.add(folder)
    folderCount += 1
    if (folderCount > VAULT_VALIDATION_LIMITS.maxFolders) {
      throw new VaultAttachmentError('invalid_vault', 'folder tree contains too many folders')
    }

    for (const rawSecret of optionalArray(folder.secrets)) {
      const secret = requireRecord(rawSecret)
      if (secret.type !== 'image') continue
      for (const rawField of requireArray(secret.fields)) {
        const field = requireRecord(rawField)
        if (field.key === '__image__') result.push(field)
      }
    }
    for (const rawChild of optionalArray(folder.children)) {
      pending.push({ folder: requireRecord(rawChild), depth: depth + 1 })
    }
  }
  return result
}

function cloneVaultWithImageFieldReplacements<T>(
  vault: T,
  replacements: ReadonlyMap<Record<string, unknown>, string>,
): T {
  if (replacements.size === 0) return vault
  const root = requireRecord(vault)

  const cloneFolder = (rawFolder: unknown, depth: number): Record<string, unknown> => {
    if (depth > VAULT_VALIDATION_LIMITS.maxFolderDepth) {
      throw new VaultAttachmentError('invalid_vault', 'folder tree is too deep')
    }
    const folder = requireRecord(rawFolder)
    const secrets = optionalArray(folder.secrets).map(rawSecret => {
      const secret = requireRecord(rawSecret)
      if (secret.type !== 'image') return secret
      const fields = requireArray(secret.fields).map(rawField => {
        const field = requireRecord(rawField)
        const replacement = replacements.get(field)
        return replacement === undefined ? field : { ...field, value: replacement }
      })
      return { ...secret, fields }
    })
    const children = optionalArray(folder.children).map(child => cloneFolder(child, depth + 1))
    return { ...folder, secrets, children }
  }

  return { ...root, root: cloneFolder(root.root, 0) } as T
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VaultAttachmentError('invalid_vault', 'vault shape is invalid')
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new VaultAttachmentError('invalid_vault', 'vault collection is invalid')
  }
  return value
}

function optionalArray(value: unknown): unknown[] {
  return value === undefined ? [] : requireArray(value)
}

function boundedLimit(value: number | undefined, ceiling: number, label: string): number {
  const result = value ?? ceiling
  if (!Number.isSafeInteger(result) || result < 0 || result > ceiling) {
    throw new VaultAttachmentError('invalid_limit', `${label} limit is invalid`)
  }
  return result
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const contentLength = value.length - padding
  if (padding === 1 && contentLength % 4 !== 3) return false
  if (padding === 2 && contentLength % 4 !== 2) return false
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index)
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!valid) return false
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false
  }
  return true
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength))
    for (let index = 0; index < chunk.byteLength; index += 1) {
      binary += String.fromCharCode(chunk[index])
    }
  }
  return btoa(binary)
}
