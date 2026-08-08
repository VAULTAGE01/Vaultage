import { createHmac } from 'crypto'
import { constants as fsConstants, type Dirent } from 'fs'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'
import { open, seal } from './vaultCrypto'
import { VAULT_VALIDATION_LIMITS, validateVaultRoot } from '../shared/vaultValidation'

export const VAULT_RECORD_STORE_FORMAT = 'vaultage.record-store.v1'
const VAULT_RECORD_FORMAT = 'vaultage.record.v1'
const RECORD_ID_RE = /^[0-9a-f]{64}$/
const RECORD_FILE_RE = /^([0-9a-f]{64})\.enc$/
export const MAX_VAULT_RECORD_BLOB_BYTES = VAULT_VALIDATION_LIMITS.maxJsonBytes + 64 * 1024
export const VAULT_RECORD_FILE_EXTENSION = '.enc'
const DEFAULT_GC_GRACE_MS = 60 * 60 * 1000
const IO_CONCURRENCY = 8

type RecordKind =
  | 'folder'
  | 'secret'
  | 'provider'
  | 'provider-group'
  | 'env-project'
  | 'preferences'
  | 'extras'

interface StoredRecord {
  format: typeof VAULT_RECORD_FORMAT
  kind: RecordKind
  value: unknown
}

interface FolderRecordValue {
  metadata: Record<string, unknown>
  children: string[]
  secrets: string[]
}

export interface VaultRecordManifest {
  format: typeof VAULT_RECORD_STORE_FORMAT
  storageVersion: 1
  vaultVersion: number
  revision?: number
  root: string
  providers: string[]
  providerGroups: string[]
  providerGroupsPresent: boolean
  envProjects: string[]
  preferences?: string
  extras?: string
}

export interface EncodeVaultRecordStoreOptions {
  trustedRecordIds?: ReadonlySet<string>
  concurrency?: number
}

export interface EncodedVaultRecordStore {
  manifest: VaultRecordManifest
  recordIds: Set<string>
  recordsWritten: number
  plaintextBytesWritten: number
}

export interface DecodedVaultRecordStore {
  vault: Record<string, unknown>
  recordIds: Set<string>
  encryptedBytes: number
}

/**
 * Converts a canonical vault into independently encrypted, keyed-content-
 * addressed records. Only records whose content changed need to be written;
 * the caller atomically commits the small encrypted root manifest last.
 */
export async function encodeVaultRecordStore(
  vaultValue: unknown,
  vaultKey: Buffer,
  recordsDir: string,
  options: EncodeVaultRecordStoreOptions = {},
): Promise<EncodedVaultRecordStore> {
  validateVaultRoot(vaultValue, { boundary: 'persisted' })
  const vault = vaultValue as Record<string, unknown>
  const pending = new Map<string, Buffer>()

  const addRecord = (kind: RecordKind, value: unknown): string => {
    const plaintext = Buffer.from(canonicalJson({ format: VAULT_RECORD_FORMAT, kind, value }), 'utf8')
    if (plaintext.byteLength > MAX_VAULT_RECORD_BLOB_BYTES) throw new Error('Vault record is too large')
    const recordId = keyedContentId(vaultKey, plaintext)
    const existing = pending.get(recordId)
    if (existing && !existing.equals(plaintext)) throw new Error('Vault record id collision')
    pending.set(recordId, plaintext)
    return recordId
  }

  const encodeFolder = (folderValue: unknown): string => {
    const folder = record(folderValue, 'vault folder')
    const children = array(folder.children, 'vault folder children').map(encodeFolder)
    const secrets = array(folder.secrets, 'vault folder secrets')
      .map(secret => addRecord('secret', secret))
    const { children: _children, secrets: _secrets, ...metadata } = folder
    return addRecord('folder', { metadata, children, secrets } satisfies FolderRecordValue)
  }

  const root = encodeFolder(vault.root)
  const providers = array(vault.providers ?? [], 'vault providers')
    .map(provider => addRecord('provider', provider))
  const providerGroupsPresent = Object.prototype.hasOwnProperty.call(vault, 'providerGroups')
  const providerGroups = array(vault.providerGroups ?? [], 'vault provider groups')
    .map(group => addRecord('provider-group', group))
  const envProjects = array(vault.envProjects ?? [], 'vault projects')
    .map(project => addRecord('env-project', project))
  const preferences = vault.preferences === undefined
    ? undefined
    : addRecord('preferences', vault.preferences)

  const {
    version: _version,
    revision: _revision,
    root: _root,
    providers: _providers,
    providerGroups: _providerGroups,
    envProjects: _envProjects,
    preferences: _preferences,
    ...extraValues
  } = vault
  const extras = Object.keys(extraValues).length > 0 ? addRecord('extras', extraValues) : undefined

  const manifest: VaultRecordManifest = {
    format: VAULT_RECORD_STORE_FORMAT,
    storageVersion: 1,
    vaultVersion: positiveInteger(vault.version, 'vault version'),
    revision: optionalPositiveInteger(vault.revision, 'vault revision'),
    root,
    providers,
    providerGroups,
    providerGroupsPresent,
    envProjects,
    preferences,
    extras,
  }
  validateVaultRecordManifest(manifest)

  await ensurePrivateDir(recordsDir)
  let recordsWritten = 0
  let plaintextBytesWritten = 0
  const trusted = options.trustedRecordIds ?? new Set<string>()
  await mapLimit([...pending.entries()], options.concurrency ?? IO_CONCURRENCY, async ([recordId, plaintext]) => {
    if (trusted.has(recordId)) return
    const path = recordPath(recordsDir, recordId)
    try {
      const current = await readRecordBlob(path)
      verifyRecordBlob(recordId, current, vaultKey)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const encryptionKey = deriveRecordEncryptionKey(vaultKey, recordId)
    try {
      await atomicWritePrivateFile(path, seal(plaintext, encryptionKey))
      recordsWritten += 1
      plaintextBytesWritten += plaintext.byteLength
    } finally {
      encryptionKey.fill(0)
    }
  })

  return {
    manifest,
    recordIds: new Set(pending.keys()),
    recordsWritten,
    plaintextBytesWritten,
  }
}

export async function decodeVaultRecordStore(
  manifestValue: unknown,
  vaultKey: Buffer,
  recordsDir: string,
): Promise<DecodedVaultRecordStore> {
  return decodeVaultRecordStoreWithReader(
    manifestValue,
    vaultKey,
    recordId => readRecordBlob(recordPath(recordsDir, recordId)),
  )
}

export async function decodeVaultRecordStoreFromBlobs(
  manifestValue: unknown,
  vaultKey: Buffer,
  blobs: ReadonlyMap<string, Buffer>,
): Promise<DecodedVaultRecordStore> {
  return decodeVaultRecordStoreWithReader(manifestValue, vaultKey, async (recordId) => {
    const blob = blobs.get(recordId)
    if (!blob) throw new Error(`Vault record is missing: ${recordId}`)
    return Buffer.from(blob)
  })
}

async function decodeVaultRecordStoreWithReader(
  manifestValue: unknown,
  vaultKey: Buffer,
  readBlob: (recordId: string) => Promise<Buffer>,
): Promise<DecodedVaultRecordStore> {
  const manifest = validateVaultRecordManifest(manifestValue)
  const cache = new Map<string, Promise<StoredRecord>>()
  let encryptedBytes = 0

  const load = (recordId: string, expectedKind: RecordKind): Promise<StoredRecord> => {
    const safeId = validateRecordId(recordId)
    let pending = cache.get(safeId)
    if (!pending) {
      pending = (async () => {
        const blob = await readBlob(safeId)
        encryptedBytes += blob.byteLength
        return verifyRecordBlob(safeId, blob, vaultKey)
      })()
      cache.set(safeId, pending)
    }
    return pending.then(stored => {
      if (stored.kind !== expectedKind) throw new Error(`Vault record kind mismatch for ${safeId}`)
      return stored
    })
  }

  const decodeFolder = async (recordId: string, ancestry: Set<string>): Promise<Record<string, unknown>> => {
    if (ancestry.has(recordId)) throw new Error('Vault record folder cycle detected')
    const nextAncestry = new Set(ancestry).add(recordId)
    const stored = await load(recordId, 'folder')
    const value = record(stored.value, 'folder record')
    const metadata = record(value.metadata, 'folder metadata')
    const childIds = recordIds(value.children, 'folder child records', VAULT_VALIDATION_LIMITS.maxFolders)
    const secretIds = recordIds(value.secrets, 'folder secret records', VAULT_VALIDATION_LIMITS.maxSecrets)
    const [children, secrets] = await Promise.all([
      mapLimit(childIds, IO_CONCURRENCY, childId => decodeFolder(childId, nextAncestry)),
      mapLimit(secretIds, IO_CONCURRENCY, async secretId => (await load(secretId, 'secret')).value),
    ])
    return { ...metadata, children, secrets }
  }

  const [root, providers, providerGroups, envProjects, preferencesRecord, extrasRecord] = await Promise.all([
    decodeFolder(manifest.root, new Set()),
    mapLimit(manifest.providers, IO_CONCURRENCY, async id => (await load(id, 'provider')).value),
    mapLimit(manifest.providerGroups, IO_CONCURRENCY, async id => (await load(id, 'provider-group')).value),
    mapLimit(manifest.envProjects, IO_CONCURRENCY, async id => (await load(id, 'env-project')).value),
    manifest.preferences ? load(manifest.preferences, 'preferences') : Promise.resolve(null),
    manifest.extras ? load(manifest.extras, 'extras') : Promise.resolve(null),
  ])
  const extras = extrasRecord ? record(extrasRecord.value, 'vault extras') : {}
  const vault: Record<string, unknown> = {
    ...extras,
    version: manifest.vaultVersion,
    root,
    providers,
    envProjects,
  }
  if (manifest.revision !== undefined) vault.revision = manifest.revision
  if (manifest.providerGroupsPresent) vault.providerGroups = providerGroups
  if (preferencesRecord) vault.preferences = preferencesRecord.value
  validateVaultRoot(vault, { boundary: 'persisted' })
  return { vault, recordIds: new Set(cache.keys()), encryptedBytes }
}

export function isVaultRecordManifest(value: unknown): value is VaultRecordManifest {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { format?: unknown }).format === VAULT_RECORD_STORE_FORMAT,
  )
}

export function validateVaultRecordManifest(value: unknown): VaultRecordManifest {
  const manifest = record(value, 'vault record manifest')
  if (manifest.format !== VAULT_RECORD_STORE_FORMAT || manifest.storageVersion !== 1) {
    throw new Error('Unsupported vault record manifest')
  }
  const result: VaultRecordManifest = {
    format: VAULT_RECORD_STORE_FORMAT,
    storageVersion: 1,
    vaultVersion: positiveInteger(manifest.vaultVersion, 'vault version'),
    revision: optionalPositiveInteger(manifest.revision, 'vault revision'),
    root: validateRecordId(manifest.root),
    providers: recordIds(manifest.providers, 'provider records', VAULT_VALIDATION_LIMITS.maxProviders),
    providerGroups: recordIds(
      manifest.providerGroups,
      'provider-group records',
      VAULT_VALIDATION_LIMITS.maxProviderGroups,
    ),
    providerGroupsPresent: boolean(manifest.providerGroupsPresent, 'provider-groups presence'),
    envProjects: recordIds(manifest.envProjects, 'project records', VAULT_VALIDATION_LIMITS.maxProjects),
    preferences: manifest.preferences === undefined ? undefined : validateRecordId(manifest.preferences),
    extras: manifest.extras === undefined ? undefined : validateRecordId(manifest.extras),
  }
  return result
}

export async function readVaultRecordBlobs(
  recordsDir: string,
  recordIdsToRead: ReadonlySet<string>,
  maxCount = maxVaultRecordCount(),
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<Map<string, Buffer>> {
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || recordIdsToRead.size > maxCount) {
    throw new Error('Vault contains too many records')
  }
  validateAggregateByteLimit(maxBytes)
  const result = new Map<string, Buffer>()
  let totalBytes = 0
  await mapLimit([...recordIdsToRead], IO_CONCURRENCY, async recordId => {
    const blob = await readRecordBlob(recordPath(recordsDir, recordId))
    totalBytes += blob.byteLength
    if (totalBytes > maxBytes) throw new Error('Vault records exceed the aggregate size limit')
    result.set(recordId, blob)
  })
  return result
}

export async function measureVaultRecordBlobBytes(
  recordsDir: string,
  recordIdsToMeasure: ReadonlySet<string>,
  maxCount = maxVaultRecordCount(),
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<number> {
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || recordIdsToMeasure.size > maxCount) {
    throw new Error('Vault contains too many records')
  }
  validateAggregateByteLimit(maxBytes)
  let totalBytes = 0
  await mapLimit([...recordIdsToMeasure], IO_CONCURRENCY, async recordId => {
    totalBytes += await readRecordBlobSize(recordPath(recordsDir, recordId))
    if (totalBytes > maxBytes) throw new Error('Vault records exceed the aggregate size limit')
  })
  return totalBytes
}

export async function writeVaultRecordBlobs(
  recordsDir: string,
  blobs: ReadonlyMap<string, Buffer>,
  beforeCommit: () => void = () => undefined,
  maxCount = maxVaultRecordCount(),
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<void> {
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || blobs.size > maxCount) {
    throw new Error('Backup contains too many vault records')
  }
  validateAggregateByteLimit(maxBytes)
  let totalBytes = 0
  for (const blob of blobs.values()) {
    totalBytes += blob.byteLength
    if (totalBytes > maxBytes) throw new Error('Backup vault records exceed the aggregate size limit')
  }
  await ensurePrivateDir(recordsDir)
  await mapLimit([...blobs], IO_CONCURRENCY, async ([recordId, blob]) => {
    validateRecordId(recordId)
    if (blob.byteLength < 29 || blob.byteLength > MAX_VAULT_RECORD_BLOB_BYTES) {
      throw new Error('Backup vault record has an invalid size')
    }
    await atomicWritePrivateFile(recordPath(recordsDir, recordId), blob, { beforeCommit })
  })
}

export async function garbageCollectVaultRecords(
  recordsDir: string,
  referencedRecordIds: ReadonlySet<string>,
  options: { nowMs?: number; graceMs?: number } = {},
): Promise<number> {
  const nowMs = options.nowMs ?? Date.now()
  const graceMs = options.graceMs ?? DEFAULT_GC_GRACE_MS
  let entries: Dirent[]
  try {
    entries = await fs.readdir(recordsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let removed = 0
  await mapLimit(entries, IO_CONCURRENCY, async entry => {
    const match = RECORD_FILE_RE.exec(entry.name)
    if (!match || !entry.isFile() || referencedRecordIds.has(match[1])) return
    const path = join(recordsDir, entry.name)
    const stat = await fs.stat(path)
    if (nowMs - stat.mtimeMs < graceMs) return
    await fs.rm(path, { force: true })
    removed += 1
  })
  return removed
}

function verifyRecordBlob(recordId: string, blob: Buffer, vaultKey: Buffer): StoredRecord {
  if (blob.byteLength < 29 || blob.byteLength > MAX_VAULT_RECORD_BLOB_BYTES) {
    throw new Error(`Vault record has an invalid size: ${recordId}`)
  }
  const encryptionKey = deriveRecordEncryptionKey(vaultKey, recordId)
  let plaintext: Buffer | null = null
  try {
    plaintext = open(blob, encryptionKey)
    if (keyedContentId(vaultKey, plaintext) !== recordId) throw new Error('Vault record content id mismatch')
    const parsed = JSON.parse(plaintext.toString('utf8')) as unknown
    const stored = record(parsed, 'vault record')
    if (stored.format !== VAULT_RECORD_FORMAT || !isRecordKind(stored.kind)) {
      throw new Error('Invalid vault record format')
    }
    return { format: VAULT_RECORD_FORMAT, kind: stored.kind, value: stored.value }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Vault record is not valid JSON')
    throw error
  } finally {
    plaintext?.fill(0)
    encryptionKey.fill(0)
  }
}

async function readRecordBlob(path: string): Promise<Buffer> {
  let handle: fs.FileHandle | null = null
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(path, fsConstants.O_RDONLY | noFollow)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 29 || stat.size > MAX_VAULT_RECORD_BLOB_BYTES) {
      throw new Error(`Vault record entry has an invalid size: ${basename(path)}`)
    }
    return await handle.readFile()
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function readRecordBlobSize(path: string): Promise<number> {
  let handle: fs.FileHandle | null = null
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(path, fsConstants.O_RDONLY | noFollow)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 29 || stat.size > MAX_VAULT_RECORD_BLOB_BYTES) {
      throw new Error(`Vault record entry has an invalid size: ${basename(path)}`)
    }
    return stat.size
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function validateAggregateByteLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid aggregate vault-record size limit')
}

function recordPath(recordsDir: string, recordId: string): string {
  return join(recordsDir, `${validateRecordId(recordId)}.enc`)
}

function keyedContentId(vaultKey: Buffer, plaintext: Buffer): string {
  const indexKey = derivePurposeKey(vaultKey, 'vaultage-record-index-v1')
  try {
    return createHmac('sha256', indexKey).update(plaintext).digest('hex')
  } finally {
    indexKey.fill(0)
  }
}

function deriveRecordEncryptionKey(vaultKey: Buffer, recordId: string): Buffer {
  return derivePurposeKey(vaultKey, `vaultage-record-encryption-v1\0${validateRecordId(recordId)}`)
}

function derivePurposeKey(vaultKey: Buffer, purpose: string): Buffer {
  return createHmac('sha256', vaultKey).update(purpose, 'utf8').digest()
}

function validateRecordId(value: unknown): string {
  if (typeof value !== 'string' || !RECORD_ID_RE.test(value)) throw new Error('Invalid vault record id')
  return value
}

function recordIds(value: unknown, label: string, max: number): string[] {
  const values = array(value, label)
  if (values.length > max) throw new Error(`${label} contains too many entries`)
  return values.map(validateRecordId)
}

export function maxVaultRecordCount(): number {
  return VAULT_VALIDATION_LIMITS.maxFolders
    + VAULT_VALIDATION_LIMITS.maxSecrets
    + VAULT_VALIDATION_LIMITS.maxProviders
    + VAULT_VALIDATION_LIMITS.maxProviderGroups
    + VAULT_VALIDATION_LIMITS.maxProjects
    + 2
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : positiveInteger(value, label)
}

function isRecordKind(value: unknown): value is RecordKind {
  return value === 'folder'
    || value === 'secret'
    || value === 'provider'
    || value === 'provider-group'
    || value === 'env-project'
    || value === 'preferences'
    || value === 'extras'
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key]
    if (item !== undefined) result[key] = canonicalValue(item)
  }
  return result
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid record-store concurrency')
  const results = new Array<R>(values.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= values.length) return
      results[index] = await mapper(values[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
