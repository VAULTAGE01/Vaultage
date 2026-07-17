import { createHmac, timingSafeEqual } from 'crypto'
import { constants as fsConstants, promises as fs } from 'fs'
import { basename, join } from 'path'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'
import { KEY_LENGTH, open, seal } from './vaultCrypto'
import {
  VAULT_ATTACHMENT_ENVELOPE_BYTES,
  VAULT_ATTACHMENT_LIMITS,
  VaultAttachmentError,
  type VaultAttachmentBlobLimits,
  type VaultAttachmentBlobSummary,
  type VaultAttachmentInput,
  type VaultAttachmentReference,
  formatVaultAttachmentRef,
  parseVaultAttachmentRef,
  verifyVaultAttachmentBlobMap,
} from '../shared/vaultAttachments'

export const DEFAULT_ATTACHMENT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000
export const VAULT_ATTACHMENT_FILE_EXTENSION = '.blob'

const ATTACHMENT_ID_DOMAIN = Buffer.from('vaultage.attachment.id.v1\0', 'utf8')
const ATTACHMENT_KEY_DOMAIN = Buffer.from('vaultage.attachment.key.v1\0', 'utf8')
const ATTACHMENT_FILENAME_RE = /^([0-9a-f]{64})\.blob$/
const EMPTY_ID = '0'.repeat(64)

export interface VaultAttachmentStoreOptions {
  maxCount?: number
  maxAggregateEncryptedBytes?: number
  maxDirectoryEntries?: number
  orphanGraceMs?: number
}

export interface VaultAttachmentGarbageCollectionOptions {
  graceMs?: number
  nowMs?: number
}

export interface VaultAttachmentGarbageCollectionResult {
  scannedEntries: number
  referenced: number
  deleted: number
  deletedBytes: number
  retainedYoung: number
  retainedUnknown: number
  retainedChanged: number
}

export class VaultAttachmentStoreError extends Error {
  readonly name = 'VaultAttachmentStoreError'

  constructor(
    readonly code: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options)
  }
}

interface StoreUsage {
  count: number
  encryptedBytes: number
}

interface AttachmentFile {
  id: string
  path: string
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

interface DirectorySnapshot {
  files: AttachmentFile[]
  usage: StoreUsage
  scannedEntries: number
  unknownEntries: number
}

/** Vault-keyed, domain-separated content identity. */
export function computeVaultAttachmentId(
  vaultKey: Uint8Array,
  input: VaultAttachmentInput,
): string {
  requireVaultKey(vaultKey)
  requireAttachmentInput(input)
  // Reuse the strict shared media-type grammar without exporting a second
  // subtly different validator.
  formatVaultAttachmentRef(EMPTY_ID, input.mediaType)
  const mediaType = Buffer.from(input.mediaType, 'utf8')
  const mediaLength = Buffer.allocUnsafe(2)
  mediaLength.writeUInt16BE(mediaType.byteLength)
  return createHmac('sha256', vaultKey)
    .update(ATTACHMENT_ID_DOMAIN)
    .update(mediaLength)
    .update(mediaType)
    .update(input.bytes)
    .digest('hex')
}

export function createVaultAttachmentRef(
  vaultKey: Uint8Array,
  input: VaultAttachmentInput,
): string {
  return formatVaultAttachmentRef(computeVaultAttachmentId(vaultKey, input), input.mediaType)
}

/**
 * Verifies exact membership, size bounds, AES-GCM authentication, per-ID key
 * binding, and keyed content identity before a backup map is accepted.
 */
export function verifyVaultAttachmentBackupBlobMap(
  vaultKey: Uint8Array,
  references: Iterable<string | VaultAttachmentReference>,
  blobs: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
  limits: VaultAttachmentBlobLimits = {},
): VaultAttachmentBlobSummary {
  requireVaultKey(vaultKey)
  const referenceList = [...references]
  const summary = verifyVaultAttachmentBlobMap(referenceList, blobs, limits)
  const referenceById = new Map<string, VaultAttachmentReference>()
  for (const raw of referenceList) {
    const reference = normalizeReference(raw)
    referenceById.set(reference.id, reference)
  }
  const entries = blobs instanceof Map ? blobs.entries() : Object.entries(blobs)
  for (const [id, blob] of entries) {
    const reference = referenceById.get(id)
    if (!reference) {
      throw new VaultAttachmentStoreError('backup_mismatch', 'Attachment backup membership check failed')
    }
    const plain = decryptAndVerify(vaultKey, reference, blob)
    plain.fill(0)
  }
  return summary
}

export class VaultAttachmentStore {
  readonly directory: string
  readonly maxCount: number
  readonly maxAggregateEncryptedBytes: number
  readonly maxDirectoryEntries: number
  readonly orphanGraceMs: number

  private operationQueue = Promise.resolve()
  private usage: StoreUsage | null = null

  constructor(directory: string, options: VaultAttachmentStoreOptions = {}) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new VaultAttachmentStoreError('invalid_directory', 'Attachment directory is required')
    }
    this.directory = directory
    this.maxCount = boundedInteger(options.maxCount, VAULT_ATTACHMENT_LIMITS.maxCount, 'attachment count')
    this.maxAggregateEncryptedBytes = boundedInteger(
      options.maxAggregateEncryptedBytes,
      VAULT_ATTACHMENT_LIMITS.maxAggregateEncryptedBytes,
      'aggregate attachment bytes',
    )
    this.maxDirectoryEntries = boundedInteger(
      options.maxDirectoryEntries,
      VAULT_ATTACHMENT_LIMITS.maxCount + 4_096,
      'attachment directory entries',
    )
    if (this.maxDirectoryEntries < this.maxCount) {
      throw new VaultAttachmentStoreError(
        'invalid_limit',
        'Attachment directory-entry limit cannot be lower than its attachment limit',
      )
    }
    this.orphanGraceMs = boundedDuration(
      options.orphanGraceMs,
      DEFAULT_ATTACHMENT_ORPHAN_GRACE_MS,
      'orphan grace period',
    )
  }

  /** Encrypts and atomically stores an attachment; identical content deduplicates. */
  put(vaultKey: Uint8Array, input: VaultAttachmentInput): Promise<string> {
    requireVaultKey(vaultKey)
    requireAttachmentInput(input)
    const stableInput: VaultAttachmentInput = {
      mediaType: input.mediaType,
      bytes: Buffer.from(input.bytes),
    }
    let referenceValue: string
    let reference: VaultAttachmentReference
    try {
      referenceValue = createVaultAttachmentRef(vaultKey, stableInput)
      reference = parseVaultAttachmentRef(referenceValue)
    } catch (error) {
      stableInput.bytes.fill(0)
      throw error
    }

    return this.enqueue(async () => {
      await this.ensureDirectory()
      const path = this.pathForId(reference.id)
      try {
        const existing = await readEncryptedFile(path)
        const plain = decryptAndVerify(vaultKey, reference, existing)
        plain.fill(0)
        return referenceValue
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }

      const derivedKey = deriveAttachmentKey(vaultKey, reference.id)
      let blob: Buffer
      try {
        blob = seal(asBuffer(stableInput.bytes), derivedKey)
      } finally {
        derivedKey.fill(0)
      }

      const usage = await this.loadUsage()
      this.assertProjectedUsage(usage.count + 1, usage.encryptedBytes + blob.byteLength)
      await atomicWritePrivateFile(path, blob)
      usage.count += 1
      usage.encryptedBytes += blob.byteLength
      return referenceValue
    }).finally(() => stableInput.bytes.fill(0))
  }

  /** Reads, authenticates, and rechecks keyed content identity. */
  read(vaultKey: Uint8Array, rawReference: string | VaultAttachmentReference): Promise<Buffer> {
    requireVaultKey(vaultKey)
    const reference = normalizeReference(rawReference)
    return this.enqueue(async () => {
      await this.ensureDirectory()
      const blob = await readEncryptedFile(this.pathForId(reference.id))
      return decryptAndVerify(vaultKey, reference, blob)
    })
  }

  /** Returns a cryptographically verified raw blob map for a portable backup. */
  createBackupBlobMap(
    vaultKey: Uint8Array,
    references: Iterable<string | VaultAttachmentReference>,
  ): Promise<Map<string, Buffer>> {
    requireVaultKey(vaultKey)
    const referenceList = normalizeReferences(references, this.maxCount)
    return this.enqueue(async () => {
      await this.ensureDirectory()
      const blobs = new Map<string, Buffer>()
      let encryptedBytes = 0
      for (const reference of referenceList.values()) {
        const blob = await readEncryptedFile(this.pathForId(reference.id))
        encryptedBytes += blob.byteLength
        if (encryptedBytes > this.maxAggregateEncryptedBytes) {
          throw new VaultAttachmentStoreError('size_limit', 'Attachment backup exceeds its byte limit')
        }
        blobs.set(reference.id, blob)
      }
      verifyVaultAttachmentBackupBlobMap(vaultKey, referenceList.values(), blobs, {
        maxCount: this.maxCount,
        maxAggregateEncryptedBytes: this.maxAggregateEncryptedBytes,
      })
      return blobs
    })
  }

  /** Verifies the complete map before writing any restored blob. */
  restoreBackupBlobMap(
    vaultKey: Uint8Array,
    references: Iterable<string | VaultAttachmentReference>,
    blobs: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
  ): Promise<VaultAttachmentBlobSummary> {
    requireVaultKey(vaultKey)
    const referenceList = normalizeReferences(references, this.maxCount)
    // Perform cheap structural validation before copying, then authenticate the
    // stable copies that will actually be written. This closes the mutation
    // window between verification and the queued restore operation.
    verifyVaultAttachmentBlobMap(referenceList.values(), blobs, {
      maxCount: this.maxCount,
      maxAggregateEncryptedBytes: this.maxAggregateEncryptedBytes,
    })
    const sourceEntries = blobs instanceof Map ? [...blobs.entries()] : Object.entries(blobs)
    const stableBlobs = new Map(sourceEntries.map(([id, blob]) => [id, Buffer.from(blob)]))
    const summary = verifyVaultAttachmentBackupBlobMap(vaultKey, referenceList.values(), stableBlobs, {
      maxCount: this.maxCount,
      maxAggregateEncryptedBytes: this.maxAggregateEncryptedBytes,
    })
    const entries = [...stableBlobs.entries()]

    return this.enqueue(async () => {
      await this.ensureDirectory()
      const usage = await this.loadUsage()
      const writes: { id: string; blob: Uint8Array; isNew: boolean; byteDelta: number }[] = []
      let newCount = 0
      let byteDelta = 0
      for (const [id, blob] of entries) {
        let existing: Buffer
        try {
          existing = await readEncryptedFile(this.pathForId(id))
        } catch (error) {
          if (!isMissingFile(error)) throw error
          writes.push({ id, blob, isNew: true, byteDelta: blob.byteLength })
          newCount += 1
          byteDelta += blob.byteLength
          continue
        }

        try {
          const reference = referenceList.get(id)!
          const plain = decryptAndVerify(vaultKey, reference, existing)
          plain.fill(0)
        } catch (error) {
          if (!isRepairableIntegrityError(error)) throw error
          const replacementDelta = blob.byteLength - existing.byteLength
          writes.push({ id, blob, isNew: false, byteDelta: replacementDelta })
          byteDelta += replacementDelta
        }
      }
      this.assertProjectedUsage(usage.count + newCount, usage.encryptedBytes + byteDelta)

      for (const write of writes) {
        await atomicWritePrivateFile(this.pathForId(write.id), asBuffer(write.blob))
        if (write.isNew) usage.count += 1
        usage.encryptedBytes += write.byteDelta
      }
      return summary
    }).finally(() => {
      for (const blob of stableBlobs.values()) blob.fill(0)
    })
  }

  /**
   * Deletes only canonical, regular, unreferenced blobs older than the grace
   * period. Unknown entries, links, young files, and files changed mid-scan are
   * retained.
   */
  garbageCollect(
    references: Iterable<string | VaultAttachmentReference>,
    options: VaultAttachmentGarbageCollectionOptions = {},
  ): Promise<VaultAttachmentGarbageCollectionResult> {
    const referenceList = normalizeReferences(references, this.maxCount)
    const graceMs = boundedDuration(options.graceMs, this.orphanGraceMs, 'orphan grace period')
    const nowMs = options.nowMs ?? Date.now()
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new VaultAttachmentStoreError('invalid_time', 'Attachment garbage-collection time is invalid')
    }

    return this.enqueue(async () => {
      await this.ensureDirectory()
      const snapshot = await this.scanDirectory()
      const cutoff = nowMs - graceMs
      let deleted = 0
      let deletedBytes = 0
      let retainedYoung = 0
      let retainedChanged = 0
      let usageNeedsRescan = false

      for (const file of snapshot.files) {
        if (referenceList.has(file.id)) continue
        if (file.mtimeMs > cutoff) {
          retainedYoung += 1
          continue
        }

        let current: Awaited<ReturnType<typeof fs.lstat>>
        try {
          current = await fs.lstat(file.path)
        } catch (error) {
          if (isMissingFile(error)) continue
          throw error
        }
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          !sameFileIdentity(file, current) ||
          current.mtimeMs > cutoff
        ) {
          retainedChanged += 1
          continue
        }
        try {
          await fs.unlink(file.path)
        } catch (error) {
          if (isMissingFile(error)) {
            usageNeedsRescan = true
            continue
          }
          throw error
        }
        deleted += 1
        deletedBytes += file.size
      }

      this.usage = usageNeedsRescan
        ? null
        : {
            count: snapshot.usage.count - deleted,
            encryptedBytes: snapshot.usage.encryptedBytes - deletedBytes,
          }
      return {
        scannedEntries: snapshot.scannedEntries,
        referenced: referenceList.size,
        deleted,
        deletedBytes,
        retainedYoung,
        retainedUnknown: snapshot.unknownEntries,
        retainedChanged,
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.catch(() => undefined).then(operation)
    this.operationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private pathForId(id: string): string {
    // Parsing every externally supplied reference before this call guarantees
    // that join cannot be influenced by separators or traversal segments.
    return join(this.directory, `${id}${VAULT_ATTACHMENT_FILE_EXTENSION}`)
  }

  private async ensureDirectory(): Promise<void> {
    try {
      const current = await fs.lstat(this.directory)
      if (!current.isDirectory() || current.isSymbolicLink()) {
        throw new VaultAttachmentStoreError('unsafe_directory', 'Attachment store must be a real directory')
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error
      await ensurePrivateDir(this.directory)
    }
    const verified = await fs.lstat(this.directory)
    if (!verified.isDirectory() || verified.isSymbolicLink()) {
      throw new VaultAttachmentStoreError('unsafe_directory', 'Attachment store must be a real directory')
    }
  }

  private async loadUsage(): Promise<StoreUsage> {
    if (this.usage) return this.usage
    const snapshot = await this.scanDirectory()
    this.usage = snapshot.usage
    return this.usage
  }

  private async scanDirectory(): Promise<DirectorySnapshot> {
    const files: AttachmentFile[] = []
    let scannedEntries = 0
    let unknownEntries = 0
    let encryptedBytes = 0
    const directory = await fs.opendir(this.directory)
    try {
      for await (const entry of directory) {
        scannedEntries += 1
        if (scannedEntries > this.maxDirectoryEntries) {
          throw new VaultAttachmentStoreError('count_limit', 'Attachment directory contains too many entries')
        }
        const match = ATTACHMENT_FILENAME_RE.exec(entry.name)
        if (!match) {
          unknownEntries += 1
          continue
        }
        const path = join(this.directory, entry.name)
        let stat: Awaited<ReturnType<typeof fs.lstat>>
        try {
          stat = await fs.lstat(path)
        } catch (error) {
          if (isMissingFile(error)) {
            unknownEntries += 1
            continue
          }
          throw error
        }
        if (!stat.isFile() || stat.isSymbolicLink()) {
          unknownEntries += 1
          continue
        }
        if (
          stat.size <= VAULT_ATTACHMENT_ENVELOPE_BYTES ||
          stat.size > VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes
        ) {
          throw new VaultAttachmentStoreError('size_limit', 'Stored attachment is outside the supported size range')
        }
        encryptedBytes += stat.size
        files.push({
          id: match[1],
          path,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          dev: stat.dev,
          ino: stat.ino,
        })
        this.assertProjectedUsage(files.length, encryptedBytes)
      }
    } finally {
      await directory.close().catch(() => undefined)
    }
    return {
      files,
      usage: { count: files.length, encryptedBytes },
      scannedEntries,
      unknownEntries,
    }
  }

  private assertProjectedUsage(count: number, encryptedBytes: number): void {
    if (count > this.maxCount) {
      throw new VaultAttachmentStoreError('count_limit', 'Attachment store exceeds its file-count limit')
    }
    if (encryptedBytes > this.maxAggregateEncryptedBytes) {
      throw new VaultAttachmentStoreError('size_limit', 'Attachment store exceeds its aggregate byte limit')
    }
  }
}

function deriveAttachmentKey(vaultKey: Uint8Array, id: string): Buffer {
  requireVaultKey(vaultKey)
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new VaultAttachmentStoreError('invalid_id', 'Attachment identifier is invalid')
  }
  return createHmac('sha256', vaultKey)
    .update(ATTACHMENT_KEY_DOMAIN)
    .update(Buffer.from(id, 'hex'))
    .digest()
}

function decryptAndVerify(
  vaultKey: Uint8Array,
  reference: VaultAttachmentReference,
  encrypted: Uint8Array,
): Buffer {
  if (
    encrypted.byteLength <= VAULT_ATTACHMENT_ENVELOPE_BYTES ||
    encrypted.byteLength > VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes
  ) {
    throw new VaultAttachmentStoreError('size_limit', 'Encrypted attachment is outside the supported size range')
  }
  const derivedKey = deriveAttachmentKey(vaultKey, reference.id)
  let plain: Buffer
  try {
    plain = open(asBuffer(encrypted), derivedKey)
  } catch (cause) {
    throw new VaultAttachmentStoreError('integrity', 'Attachment integrity check failed', { cause })
  } finally {
    derivedKey.fill(0)
  }

  try {
    requireAttachmentInput({ mediaType: reference.mediaType, bytes: plain })
    const actualId = computeVaultAttachmentId(vaultKey, {
      mediaType: reference.mediaType,
      bytes: plain,
    })
    const expectedBytes = Buffer.from(reference.id, 'hex')
    const actualBytes = Buffer.from(actualId, 'hex')
    if (!timingSafeEqual(expectedBytes, actualBytes)) {
      throw new VaultAttachmentStoreError('integrity', 'Attachment content identity check failed')
    }
    return plain
  } catch (error) {
    plain.fill(0)
    throw error
  }
}

async function readEncryptedFile(path: string): Promise<Buffer> {
  let handle: fs.FileHandle | null = null
  try {
    const before = await fs.lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new VaultAttachmentStoreError('unsafe_file', 'Attachment entry must be a regular file')
    }
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(path, fsConstants.O_RDONLY | noFollow)
    const stat = await handle.stat()
    if (!stat.isFile() || !sameStatsIdentity(before, stat)) {
      throw new VaultAttachmentStoreError('unsafe_file', 'Attachment entry changed while it was opened')
    }
    if (
      stat.size <= VAULT_ATTACHMENT_ENVELOPE_BYTES ||
      stat.size > VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes
    ) {
      throw new VaultAttachmentStoreError('size_limit', `Attachment entry has an invalid size: ${basename(path)}`)
    }
    const result = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < result.byteLength) {
      const { bytesRead } = await handle.read(result, offset, result.byteLength - offset, null)
      if (bytesRead === 0) {
        throw new VaultAttachmentStoreError('unsafe_file', 'Attachment entry changed while it was read')
      }
      offset += bytesRead
    }
    const probe = Buffer.allocUnsafe(1)
    const { bytesRead: trailingBytes } = await handle.read(probe, 0, 1, null)
    const after = await handle.stat()
    if (
      trailingBytes !== 0 ||
      !sameStatsIdentity(stat, after) ||
      stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs
    ) {
      throw new VaultAttachmentStoreError('unsafe_file', 'Attachment entry changed while it was read')
    }
    return result
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function normalizeReference(raw: string | VaultAttachmentReference): VaultAttachmentReference {
  const reference = typeof raw === 'string' ? parseVaultAttachmentRef(raw) : parseVaultAttachmentRef(raw.value)
  if (
    typeof raw !== 'string' &&
    (raw.version !== reference.version || raw.id !== reference.id || raw.mediaType !== reference.mediaType)
  ) {
    throw new VaultAttachmentError('invalid_ref', 'reference fields do not match its canonical value')
  }
  return reference
}

function normalizeReferences(
  references: Iterable<string | VaultAttachmentReference>,
  maxCount: number,
): Map<string, VaultAttachmentReference> {
  const result = new Map<string, VaultAttachmentReference>()
  for (const raw of references) {
    const reference = normalizeReference(raw)
    const current = result.get(reference.id)
    if (current && current.mediaType !== reference.mediaType) {
      throw new VaultAttachmentStoreError('id_collision', 'Attachment identifier has conflicting media types')
    }
    result.set(reference.id, reference)
    if (result.size > maxCount) {
      throw new VaultAttachmentStoreError('count_limit', 'Attachment reference count exceeds its limit')
    }
  }
  return result
}

function requireVaultKey(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== KEY_LENGTH) {
    throw new VaultAttachmentStoreError('invalid_key', 'Vault attachment key must be 32 bytes')
  }
}

function requireAttachmentInput(input: VaultAttachmentInput): void {
  if (!input || typeof input.mediaType !== 'string' || !(input.bytes instanceof Uint8Array)) {
    throw new VaultAttachmentStoreError('invalid_input', 'Attachment input is invalid')
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > VAULT_ATTACHMENT_LIMITS.maxPlaintextBytes) {
    throw new VaultAttachmentStoreError('size_limit', 'Attachment is outside the supported size range')
  }
}

function asBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

function boundedInteger(value: number | undefined, ceiling: number, label: string): number {
  const result = value ?? ceiling
  if (!Number.isSafeInteger(result) || result < 0 || result > ceiling) {
    throw new VaultAttachmentStoreError('invalid_limit', `${label} limit is invalid`)
  }
  return result
}

function boundedDuration(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 0 || result > 365 * 24 * 60 * 60 * 1_000) {
    throw new VaultAttachmentStoreError('invalid_limit', `${label} is invalid`)
  }
  return result
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function isRepairableIntegrityError(error: unknown): boolean {
  return error instanceof VaultAttachmentStoreError &&
    (error.code === 'integrity' || error.code === 'size_limit')
}

function sameStatsIdentity(
  before: Awaited<ReturnType<typeof fs.lstat>>,
  after: Awaited<ReturnType<fs.FileHandle['stat']>>,
): boolean {
  return before.dev === after.dev && before.ino === after.ino
}

function sameFileIdentity(
  before: AttachmentFile,
  after: Awaited<ReturnType<typeof fs.lstat>>,
): boolean {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
}
