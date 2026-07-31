import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { constants as fsConstants } from 'fs'
import { basename, join } from 'path'
import { promises as fs } from 'fs'
import { open, seal } from './vaultCrypto'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'
import { leaseVaultKey } from './vaultSessionKey'
import {
  MAX_VAULT_RECORD_BLOB_BYTES,
  VAULT_RECORD_FILE_EXTENSION,
  decodeVaultRecordStore,
  decodeVaultRecordStoreFromBlobs,
  encodeVaultRecordStore,
  garbageCollectVaultRecords,
  isVaultRecordManifest,
  maxVaultRecordCount,
  readVaultRecordBlobs,
  writeVaultRecordBlobs,
  type VaultRecordManifest,
} from './vaultRecordStore'
import {
  VAULT_ATTACHMENT_FILE_EXTENSION,
  VaultAttachmentStore,
  verifyVaultAttachmentBackupBlobMap,
} from './vaultAttachmentStore'
import {
  VAULT_ATTACHMENT_LIMITS,
  collectVaultAttachmentRefs,
  externalizeVaultImageDataUrls,
  hydrateVaultImageAttachments,
  type VaultAttachmentReference,
} from '../shared/vaultAttachments'
import {
  VAULT_VALIDATION_LIMITS,
  VaultValidationError,
  validateVaultRoot,
} from '../shared/vaultValidation'

export const VAULT_DIR = join(app.getPath('userData'), 'vault-data')
export const VAULT_FILE = join(VAULT_DIR, 'vault.enc')
export const WRAPPED_KEY_FILE = join(VAULT_DIR, 'key.wrapped')
export const PARAMS_FILE = join(VAULT_DIR, 'params.json')
export const AUDIT_LOG_FILE = join(VAULT_DIR, 'audit.log')
export const AUTH_STATE_MANIFEST_FILE = join(VAULT_DIR, 'auth-state.json')
export const BACKUP_MANIFEST_FILE = 'vaultage-backup.json'
export const VAULT_RECORDS_DIR = join(VAULT_DIR, 'records')
export const VAULT_ATTACHMENTS_DIR = join(VAULT_DIR, 'attachments')

const STATE_FORMAT = 'vaultage.auth-state.v1'
const CREDENTIALS_FORMAT = 'vaultage.credentials.v1'
const LEGACY_BACKUP_FORMAT = 'vaultage.backup.v1'
const BACKUP_FORMAT = 'vaultage.backup.v2'
const MAX_BACKUP_VAULT_BYTES = 20 * 1024 * 1024
const MAX_BACKUP_METADATA_BYTES = 64 * 1024
const MAX_BACKUP_MANIFEST_BYTES = 20 * 1024 * 1024
const RECORD_BACKUP_DIR = 'records'
const ATTACHMENT_BACKUP_DIR = 'attachments'
const CONTENT_ID_RE = /^[0-9a-f]{64}$/

let vaultOperationQueue = Promise.resolve()

export type AuthStateStatus = 'missing' | 'ready' | 'incomplete'

export interface VaultBackupSnapshot {
  format?: typeof LEGACY_BACKUP_FORMAT | typeof BACKUP_FORMAT
  paramsRaw: string
  wrappedKey: Buffer
  vaultBlob: Buffer
  recordBlobs?: Map<string, Buffer>
  attachmentBlobs?: Map<string, Buffer>
}

/**
 * A successful return from commitVaultUpdate is an unambiguous durability
 * boundary: the encrypted replacement has already been atomically renamed
 * over the active vault path. Session assertions intentionally happen only
 * before that boundary so a lock racing immediately after rename cannot turn
 * a committed write into a reported pre-commit failure.
 */
export interface VaultCommitOutcome<T> {
  status: 'committed'
  value: T
}

interface AuthStateManifest {
  format: typeof STATE_FORMAT
  generation: string
  vaultFile: string
  credentialsFile: string
}

interface ActiveAuthState {
  manifest: AuthStateManifest | null
  vaultPath: string
  paramsRaw: string
  wrappedKey: Buffer
}

interface LoadedVaultState {
  vault: Record<string, unknown>
  persistedVault: Record<string, unknown>
  recordIds: Set<string>
  attachmentReferences: Map<string, VaultAttachmentReference>
  vaultBlob: Buffer
  legacy: boolean
}

interface PreparedVaultState {
  persistedVault: Record<string, unknown>
  manifest: VaultRecordManifest
  recordIds: Set<string>
  attachmentReferences: Map<string, VaultAttachmentReference>
  vaultBlob: Buffer
}

export async function ensureVaultDir(): Promise<void> {
  await ensurePrivateDir(VAULT_DIR)
}

export async function getAuthStateStatus(): Promise<AuthStateStatus> {
  try {
    const manifest = await readAuthStateManifest()
    if (manifest) {
      await resolveManifestState(manifest)
      return 'ready'
    }
  } catch {
    return 'incomplete'
  }

  const present = await Promise.all([
    pathExists(VAULT_FILE),
    pathExists(WRAPPED_KEY_FILE),
    pathExists(PARAMS_FILE),
  ])
  const count = present.filter(Boolean).length
  if (count === 0) return 'missing'
  if (count !== present.length) return 'incomplete'
  try {
    const [vaultBlob, wrappedKey, paramsBuffer] = await Promise.all([
      readRegularFile(VAULT_FILE, MAX_BACKUP_VAULT_BYTES),
      readRegularFile(WRAPPED_KEY_FILE, MAX_BACKUP_METADATA_BYTES),
      readRegularFile(PARAMS_FILE, MAX_BACKUP_METADATA_BYTES),
    ])
    if (vaultBlob.length < 29) throw new Error('Invalid encrypted vault length')
    validateWrappedKey(wrappedKey)
    validateParamsRaw(paramsBuffer.toString('utf8'))
    return 'ready'
  } catch {
    return 'incomplete'
  }
}

export async function accessParams(): Promise<void> {
  if (await getAuthStateStatus() !== 'ready') throw new Error('Vault authentication state is unavailable')
}

export async function readCredentials(): Promise<{ paramsRaw: string; wrappedKey: Buffer }> {
  const state = await resolveActiveState()
  return { paramsRaw: state.paramsRaw, wrappedKey: Buffer.from(state.wrappedKey) }
}

/**
 * Reads the credential half of an installation without requiring the active
 * vault ciphertext to be present. This is used only by the explicit backup
 * recovery flow so a torn/missing vault generation can still be repaired while
 * retaining same-vault verification.
 */
export async function readRecoveryCredentials(): Promise<{ paramsRaw: string; wrappedKey: Buffer }> {
  const manifest = await readAuthStateManifest()
  if (manifest) {
    const credentialsRaw = await readRegularFile(
      safeStatePath(manifest.credentialsFile),
      MAX_BACKUP_METADATA_BYTES,
    ).then(value => value.toString('utf8'))
    const credentials = parseCredentials(credentialsRaw)
    return { paramsRaw: credentials.paramsRaw, wrappedKey: Buffer.from(credentials.wrappedKey) }
  }

  const [paramsRaw, wrappedKey] = await Promise.all([
    readRegularFile(PARAMS_FILE, MAX_BACKUP_METADATA_BYTES).then(value => value.toString('utf8')),
    readRegularFile(WRAPPED_KEY_FILE, MAX_BACKUP_METADATA_BYTES),
  ])
  validateParamsRaw(paramsRaw)
  validateWrappedKey(wrappedKey)
  return { paramsRaw, wrappedKey }
}

export async function readParams(): Promise<string> {
  return (await readCredentials()).paramsRaw
}

export async function readWrappedKey(): Promise<Buffer> {
  return (await readCredentials()).wrappedKey
}

export async function createVaultState(
  input: { paramsRaw: string; wrappedKey: Buffer; vaultJson: string; vaultKey: Buffer },
  assertCurrent: () => void = () => undefined,
): Promise<void> {
  const keyLease = leaseVaultKey(input.vaultKey)
  try {
    await enqueueVaultOperation(async () => {
      await ensureVaultDir()
      if (await getAuthStateStatus() !== 'missing') {
        throw new Error('Vault is already initialized; setup cannot replace it')
      }

      assertCurrent()
      keyLease.assertCurrent()
      validateParamsRaw(input.paramsRaw)
      const initialVault = validatePersistedVaultJson(input.vaultJson)
      const prepared = await prepareVaultState(initialVault, keyLease.key)
      assertCurrent()
      keyLease.assertCurrent()
      const generation = randomUUID()
      const vaultFile = `vault.${generation}.enc`
      const credentialsFile = `credentials.${generation}.json`
      const vaultPath = join(VAULT_DIR, vaultFile)
      const credentialsPath = join(VAULT_DIR, credentialsFile)
      const credentialsRaw = serializeCredentials(input.paramsRaw, input.wrappedKey)
      const manifest = serializeManifest({ generation, vaultFile, credentialsFile })

      try {
        await atomicWritePrivateFile(vaultPath, prepared.vaultBlob, {
          beforeCommit: () => {
            assertCurrent()
            keyLease.assertCurrent()
          },
        })
        await atomicWritePrivateFile(credentialsPath, credentialsRaw, { beforeCommit: assertCurrent })
        await atomicWritePrivateFile(AUTH_STATE_MANIFEST_FILE, manifest, { beforeCommit: assertCurrent })
        await garbageCollectCommittedState(prepared)
      } catch (err) {
        await Promise.all([
          fs.rm(vaultPath, { force: true }),
          fs.rm(credentialsPath, { force: true }),
        ]).catch(() => undefined)
        throw err
      }
    })
  } finally {
    keyLease.release()
  }
}

export async function commitAuthCredentials(
  paramsRaw: string,
  wrappedKey: Buffer,
  assertCurrent: () => void = () => undefined,
): Promise<void> {
  await enqueueVaultOperation(async () => {
    await ensureVaultDir()
    const active = await resolveActiveState()
    assertCurrent()
    validateParamsRaw(paramsRaw)

    const generation = randomUUID()
    const credentialsFile = `credentials.${generation}.json`
    const credentialsPath = join(VAULT_DIR, credentialsFile)
    await atomicWritePrivateFile(credentialsPath, serializeCredentials(paramsRaw, wrappedKey), {
      beforeCommit: assertCurrent,
    })

    const vaultFile = active.manifest?.vaultFile ?? basename(active.vaultPath)
    try {
      await atomicWritePrivateFile(
        AUTH_STATE_MANIFEST_FILE,
        serializeManifest({ generation, vaultFile, credentialsFile }),
        { beforeCommit: assertCurrent },
      )
    } catch (err) {
      await fs.rm(credentialsPath, { force: true }).catch(() => undefined)
      throw err
    }
  })
}

export async function readVault(key: Buffer): Promise<unknown> {
  const keyLease = leaseVaultKey(key)
  try {
    return await enqueueVaultOperation(async () => {
      keyLease.assertCurrent()
      const state = await resolveActiveState()
      const loaded = await readVaultFile(state.vaultPath, keyLease.key)
      keyLease.assertCurrent()

      // Legacy authenticated single-document vaults are migrated in place.
      // Content-addressed blobs are committed first and the encrypted record
      // manifest replaces vault.enc last, so interruption leaves the legacy
      // ciphertext readable and only creates age-gated orphan blobs.
      if (loaded.legacy) {
        const prepared = await prepareVaultState(loaded.vault, keyLease.key)
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
          beforeCommit: keyLease.assertCurrent,
        })
        await garbageCollectCommittedState(prepared)
      }
      return loaded.vault
    })
  } finally {
    keyLease.release()
  }
}

async function readVaultFile(path: string, key: Buffer): Promise<LoadedVaultState> {
  const blob = await readRegularFile(path, MAX_BACKUP_VAULT_BYTES)
  return decodeVaultBlob(blob, key)
}

export async function writeVault(json: string, key: Buffer): Promise<void> {
  const keyLease = leaseVaultKey(key)
  try {
    await enqueueVaultOperation(async () => {
      keyLease.assertCurrent()
      const state = await resolveActiveState()
      const current = await readVaultFile(state.vaultPath, keyLease.key)
      const vault = validatePersistedVaultJson(json)
      const prepared = await prepareVaultState(vault, keyLease.key, current.recordIds)
      await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
        beforeCommit: keyLease.assertCurrent,
      })
      await garbageCollectCommittedState(prepared)
    })
  } finally {
    keyLease.release()
  }
}

export async function updateVault<T>(
  key: Buffer,
  updater: (vault: unknown) => { json: string; result: T } | Promise<{ json: string; result: T }>,
  options: { assertCurrent?: () => void } = {},
): Promise<T> {
  const outcome = await commitVaultUpdate(key, updater, options)
  return outcome.value
}

export async function commitVaultUpdate<T>(
  key: Buffer,
  updater: (vault: unknown) => { json: string; result: T } | Promise<{ json: string; result: T }>,
  options: { assertCurrent?: () => void } = {},
): Promise<VaultCommitOutcome<T>> {
  const keyLease = leaseVaultKey(key)
  const assertCurrent = () => {
    keyLease.assertCurrent()
    options.assertCurrent?.()
  }
  try {
    return await enqueueVaultOperation(async () => {
      assertCurrent()
      const state = await resolveActiveState()
      const current = await readVaultFile(state.vaultPath, keyLease.key)
      assertCurrent()
      const { json, result } = await updater(current.vault)
      assertCurrent()
      const vault = validatePersistedVaultJson(json)
      const prepared = await prepareVaultState(vault, keyLease.key, current.recordIds)
      assertCurrent()
      await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, { beforeCommit: assertCurrent })
      await garbageCollectCommittedState(prepared)
      return { status: 'committed', value: result }
    })
  } finally {
    keyLease.release()
  }
}

/**
 * Produces a portable, validated snapshot while holding the same queue used by
 * every vault and credential commit. The caller should create this inside a
 * temporary directory and rename that directory only after this resolves.
 */
export async function createVaultBackupSnapshot(targetDir: string, key: Buffer): Promise<void> {
  const keyLease = leaseVaultKey(key)
  try {
    await enqueueVaultOperation(async () => {
      keyLease.assertCurrent()
      const state = await resolveActiveState()
      let loaded = await readVaultFile(state.vaultPath, keyLease.key)
      if (loaded.legacy) {
        const prepared = await prepareVaultState(loaded.vault, keyLease.key)
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
          beforeCommit: keyLease.assertCurrent,
        })
        await garbageCollectCommittedState(prepared)
        loaded = await readVaultFile(state.vaultPath, keyLease.key)
      }
      keyLease.assertCurrent()

      const recordBlobs = await readVaultRecordBlobs(VAULT_RECORDS_DIR, loaded.recordIds)
      const attachmentBlobs = await attachmentStore().createBackupBlobMap(
        keyLease.key,
        loaded.attachmentReferences.values(),
      )
      keyLease.assertCurrent()

      await ensurePrivateDir(targetDir)
      await atomicWritePrivateFile(join(targetDir, 'vault.enc'), loaded.vaultBlob, {
        beforeCommit: keyLease.assertCurrent,
      })
      await atomicWritePrivateFile(join(targetDir, 'key.wrapped'), state.wrappedKey, {
        beforeCommit: keyLease.assertCurrent,
      })
      await atomicWritePrivateFile(join(targetDir, 'params.json'), state.paramsRaw, {
        beforeCommit: keyLease.assertCurrent,
      })
      await writeVaultRecordBlobs(
        join(targetDir, RECORD_BACKUP_DIR),
        recordBlobs,
        keyLease.assertCurrent,
      )
      await writeBackupAttachmentBlobs(
        join(targetDir, ATTACHMENT_BACKUP_DIR),
        attachmentBlobs,
        keyLease.assertCurrent,
      )
      const manifest = {
        format: BACKUP_FORMAT,
        createdAt: new Date().toISOString(),
        files: {
          'vault.enc': sha256(loaded.vaultBlob),
          'key.wrapped': sha256(state.wrappedKey),
          'params.json': sha256(Buffer.from(state.paramsRaw, 'utf8')),
        },
        records: hashBlobMap(recordBlobs),
        attachments: hashBlobMap(attachmentBlobs),
      }
      await atomicWritePrivateFile(
        join(targetDir, BACKUP_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { beforeCommit: keyLease.assertCurrent },
      )
    })
  } finally {
    keyLease.release()
  }
}

export async function readVaultBackupSnapshot(sourceDir: string): Promise<VaultBackupSnapshot> {
  const manifestRaw = await readRegularFile(
    join(sourceDir, BACKUP_MANIFEST_FILE),
    MAX_BACKUP_MANIFEST_BYTES,
  )
  const manifest = JSON.parse(manifestRaw.toString('utf8')) as {
    format?: unknown
    files?: Record<string, unknown>
    records?: Record<string, unknown>
    attachments?: Record<string, unknown>
  }
  if (
    (manifest.format !== BACKUP_FORMAT && manifest.format !== LEGACY_BACKUP_FORMAT)
    || !manifest.files
    || typeof manifest.files !== 'object'
    || Array.isArray(manifest.files)
  ) {
    throw new Error('Invalid Vaultage backup manifest')
  }

  const [vaultBlob, wrappedKey, paramsBuffer] = await Promise.all([
    readRegularFile(join(sourceDir, 'vault.enc'), MAX_BACKUP_VAULT_BYTES),
    readRegularFile(join(sourceDir, 'key.wrapped'), MAX_BACKUP_METADATA_BYTES),
    readRegularFile(join(sourceDir, 'params.json'), MAX_BACKUP_METADATA_BYTES),
  ])
  for (const [name, value] of [
    ['vault.enc', vaultBlob],
    ['key.wrapped', wrappedKey],
    ['params.json', paramsBuffer],
  ] as const) {
    if (manifest.files[name] !== sha256(value)) throw new Error(`Backup integrity check failed for ${name}`)
  }

  const paramsRaw = paramsBuffer.toString('utf8')
  validateParamsRaw(paramsRaw)
  validateWrappedKey(wrappedKey)

  if (manifest.format === LEGACY_BACKUP_FORMAT) {
    return { format: LEGACY_BACKUP_FORMAT, paramsRaw, wrappedKey, vaultBlob }
  }
  const recordBlobs = await readBackupBlobMap(
    join(sourceDir, RECORD_BACKUP_DIR),
    manifest.records,
    VAULT_RECORD_FILE_EXTENSION,
    maxVaultRecordCount(),
    MAX_VAULT_RECORD_BLOB_BYTES,
    'record',
  )
  const attachmentBlobs = await readBackupBlobMap(
    join(sourceDir, ATTACHMENT_BACKUP_DIR),
    manifest.attachments,
    VAULT_ATTACHMENT_FILE_EXTENSION,
    VAULT_ATTACHMENT_LIMITS.maxCount,
    VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes,
    'attachment',
  )
  return {
    format: BACKUP_FORMAT,
    paramsRaw,
    wrappedKey,
    vaultBlob,
    recordBlobs,
    attachmentBlobs,
  }
}

/** Fully authenticates and canonically validates a snapshot after its key is unwrapped. */
export async function validateVaultBackupSnapshot(
  snapshot: VaultBackupSnapshot,
  vaultKey: Buffer,
): Promise<Record<string, unknown>> {
  return (await decodeVaultBackupSnapshot(snapshot, vaultKey)).vault
}

export async function commitRestoredVaultState(
  snapshot: VaultBackupSnapshot,
  vaultKey: Buffer,
  assertCurrent: () => void = () => undefined,
): Promise<void> {
  const keyLease = leaseVaultKey(vaultKey)
  const assertRestoreCurrent = () => {
    keyLease.assertCurrent()
    assertCurrent()
  }
  try {
    await enqueueVaultOperation(async () => {
      await ensureVaultDir()
      assertRestoreCurrent()
      validateParamsRaw(snapshot.paramsRaw)
      const decoded = await decodeVaultBackupSnapshot(snapshot, keyLease.key)
      assertRestoreCurrent()

      let vaultBlob: Buffer
      let recordIds: Set<string>
      let attachmentReferences: Map<string, VaultAttachmentReference>
      if (snapshot.format === BACKUP_FORMAT) {
        const recordBlobs = requireBackupBlobMap(snapshot.recordBlobs, 'record')
        const attachmentBlobs = requireBackupBlobMap(snapshot.attachmentBlobs, 'attachment')
        await writeVaultRecordBlobs(VAULT_RECORDS_DIR, recordBlobs, assertRestoreCurrent)
        await attachmentStore().restoreBackupBlobMap(
          keyLease.key,
          decoded.attachmentReferences.values(),
          attachmentBlobs,
        )
        assertRestoreCurrent()
        vaultBlob = Buffer.from(snapshot.vaultBlob)
        recordIds = decoded.recordIds
        attachmentReferences = decoded.attachmentReferences
      } else {
        const prepared = await prepareVaultState(decoded.vault, keyLease.key)
        assertRestoreCurrent()
        vaultBlob = prepared.vaultBlob
        recordIds = prepared.recordIds
        attachmentReferences = prepared.attachmentReferences
      }

      const generation = randomUUID()
      const vaultFile = `vault.${generation}.enc`
      const credentialsFile = `credentials.${generation}.json`
      const vaultPath = join(VAULT_DIR, vaultFile)
      const credentialsPath = join(VAULT_DIR, credentialsFile)
      try {
        await atomicWritePrivateFile(vaultPath, vaultBlob, { beforeCommit: assertRestoreCurrent })
        await atomicWritePrivateFile(
          credentialsPath,
          serializeCredentials(snapshot.paramsRaw, snapshot.wrappedKey),
          { beforeCommit: assertRestoreCurrent },
        )
        await atomicWritePrivateFile(
          AUTH_STATE_MANIFEST_FILE,
          serializeManifest({ generation, vaultFile, credentialsFile }),
          { beforeCommit: assertRestoreCurrent },
        )
        await garbageCollectCommittedReferences(recordIds, attachmentReferences)
      } catch (err) {
        await Promise.all([
          fs.rm(vaultPath, { force: true }),
          fs.rm(credentialsPath, { force: true }),
        ]).catch(() => undefined)
        throw err
      }
    })
  } finally {
    keyLease.release()
  }
}

async function prepareVaultState(
  vault: Record<string, unknown>,
  vaultKey: Buffer,
  trustedRecordIds: ReadonlySet<string> = new Set(),
): Promise<PreparedVaultState> {
  validateVaultRoot(vault, { boundary: 'persisted' })
  const externalized = await externalizeVaultImageDataUrls(
    vault,
    input => attachmentStore().put(vaultKey, input),
  )
  const persistedVault = externalized.vault as Record<string, unknown>
  validateVaultRoot(persistedVault, { boundary: 'persisted' })
  const encoded = await encodeVaultRecordStore(persistedVault, vaultKey, VAULT_RECORDS_DIR, {
    trustedRecordIds,
  })
  const manifestJson = JSON.stringify(encoded.manifest)
  if (Buffer.byteLength(manifestJson, 'utf8') > MAX_BACKUP_VAULT_BYTES) {
    throw new Error('Vault record manifest is too large')
  }
  return {
    persistedVault,
    manifest: encoded.manifest,
    recordIds: encoded.recordIds,
    attachmentReferences: externalized.references,
    vaultBlob: seal(Buffer.from(manifestJson, 'utf8'), vaultKey),
  }
}

async function decodeVaultBlob(
  blob: Buffer,
  vaultKey: Buffer,
  options: {
    recordBlobs?: ReadonlyMap<string, Buffer>
    attachmentBlobs?: ReadonlyMap<string, Buffer>
    backup?: boolean
    hydrate?: boolean
  } = {},
): Promise<LoadedVaultState> {
  let plaintext: Buffer | null = null
  let parsed: unknown
  try {
    plaintext = open(blob, vaultKey)
    if (plaintext.byteLength > VAULT_VALIDATION_LIMITS.maxJsonBytes) {
      throw new VaultValidationError('$', 'limit', 'exceeds the maximum decrypted payload size')
    }
    try {
      parsed = JSON.parse(plaintext.toString('utf8'))
    } catch {
      throw new VaultValidationError('$', 'json', 'is not valid JSON')
    }
  } finally {
    plaintext?.fill(0)
  }

  let persistedVault: Record<string, unknown>
  let recordIds = new Set<string>()
  const legacy = !isVaultRecordManifest(parsed)
  if (legacy) {
    if (options.backup && (options.recordBlobs?.size || options.attachmentBlobs?.size)) {
      throw new Error('Legacy backup contains unexpected content-addressed blobs')
    }
    const upgraded = upgradeAuthenticatedLegacyVault(parsed)
    validateVaultRoot(upgraded, { boundary: 'persisted' })
    persistedVault = upgraded
  } else {
    const decoded = options.recordBlobs
      ? await decodeVaultRecordStoreFromBlobs(parsed, vaultKey, options.recordBlobs)
      : options.backup
        ? (() => { throw new Error('Backup is missing its vault record map') })()
        : await decodeVaultRecordStore(parsed, vaultKey, VAULT_RECORDS_DIR)
    if (options.recordBlobs && decoded.recordIds.size !== options.recordBlobs.size) {
      throw new Error('Backup contains unreferenced vault records')
    }
    persistedVault = decoded.vault
    recordIds = decoded.recordIds
  }

  const attachmentReferences = collectVaultAttachmentRefs(persistedVault)
  if (options.attachmentBlobs) {
    verifyVaultAttachmentBackupBlobMap(
      vaultKey,
      attachmentReferences.values(),
      options.attachmentBlobs,
    )
  } else if (options.backup && attachmentReferences.size > 0) {
    throw new Error('Backup is missing its attachment blob map')
  }

  let vault = persistedVault
  if (options.hydrate !== false) {
    vault = await hydrateVaultImageAttachments(
      persistedVault,
      reference => attachmentStore().read(vaultKey, reference),
    ) as Record<string, unknown>
    validateVaultRoot(vault, { boundary: 'persisted' })
  }
  return {
    vault,
    persistedVault,
    recordIds,
    attachmentReferences,
    vaultBlob: Buffer.from(blob),
    legacy,
  }
}

/**
 * Repairs shapes written by historical Vaultage builds only after the legacy
 * document has passed authenticated decryption. Imports and current record
 * manifests continue through the strict validator without this compatibility
 * path.
 */
function upgradeAuthenticatedLegacyVault(value: unknown): unknown {
  const vault = mutableRecord(value)
  const root = mutableRecord(vault?.root)
  if (!root) return value

  const secretIds = new Set<string>()
  const providerIds = collectEntityIds(vault?.providers)
  const projectIds = collectEntityIds(vault?.envProjects)
  const pending: Record<string, unknown>[] = [root]
  let visited = 0
  while (pending.length > 0 && visited <= VAULT_VALIDATION_LIMITS.maxFolders) {
    const folder = pending.pop()
    if (!folder) break
    visited += 1

    if (Array.isArray(folder.children)) {
      for (const child of folder.children) {
        const record = mutableRecord(child)
        if (record) pending.push(record)
      }
    }
    if (!Array.isArray(folder.secrets)) continue
    for (const secretValue of folder.secrets) {
      const secret = mutableRecord(secretValue)
      if (typeof secret?.id === 'string') secretIds.add(secret.id)
      if (secret?.type !== 'image' || !Array.isArray(secret.fields)) continue
      for (const fieldValue of secret.fields) {
        const field = mutableRecord(fieldValue)
        if (field?.key === '__image__' && field.sensitive === false) {
          field.sensitive = true
        }
      }
    }
  }
  const preferences = mutableRecord(vault?.preferences)
  if (preferences && Array.isArray(preferences.localDashboardPinnedOrder)) {
    preferences.localDashboardPinnedOrder = preferences.localDashboardPinnedOrder.filter(pin => (
      legacyDashboardPinExists(pin, secretIds, projectIds, providerIds)
    ))
  }
  return value
}

function collectEntityIds(value: unknown): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(value)) return ids
  for (const item of value) {
    const id = mutableRecord(item)?.id
    if (typeof id === 'string') ids.add(id)
  }
  return ids
}

function legacyDashboardPinExists(
  value: unknown,
  secretIds: ReadonlySet<string>,
  projectIds: ReadonlySet<string>,
  providerIds: ReadonlySet<string>,
): boolean {
  if (typeof value !== 'string') return true
  const separator = value.indexOf(':')
  if (separator < 0) return secretIds.has(value)
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (kind === 'secret') return secretIds.has(id)
  if (kind === 'project') return projectIds.has(id)
  if (kind === 'service') return providerIds.has(id)
  return true
}

function mutableRecord(value: unknown): Record<string, unknown> | null {
  return isMutableRecord(value) ? value : null
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function decodeVaultBackupSnapshot(
  snapshot: VaultBackupSnapshot,
  vaultKey: Buffer,
): Promise<LoadedVaultState> {
  validateParamsRaw(snapshot.paramsRaw)
  validateWrappedKey(snapshot.wrappedKey)
  if (!Buffer.isBuffer(snapshot.vaultBlob) || snapshot.vaultBlob.byteLength < 29) {
    throw new Error('Backup vault ciphertext is invalid')
  }
  if (snapshot.format === BACKUP_FORMAT) {
    return decodeVaultBlob(snapshot.vaultBlob, vaultKey, {
      recordBlobs: requireBackupBlobMap(snapshot.recordBlobs, 'record'),
      attachmentBlobs: requireBackupBlobMap(snapshot.attachmentBlobs, 'attachment'),
      backup: true,
      hydrate: false,
    })
  }
  if (snapshot.format !== undefined && snapshot.format !== LEGACY_BACKUP_FORMAT) {
    throw new Error('Unsupported Vaultage backup format')
  }
  return decodeVaultBlob(snapshot.vaultBlob, vaultKey, { backup: true, hydrate: false })
}

async function garbageCollectCommittedState(prepared: PreparedVaultState): Promise<void> {
  await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
}

async function garbageCollectCommittedReferences(
  recordIds: ReadonlySet<string>,
  attachmentReferences: ReadonlyMap<string, VaultAttachmentReference>,
): Promise<void> {
  // Cleanup is deliberately best-effort and occurs only after the encrypted
  // manifest commit. A cleanup failure must never turn a durable mutation into
  // a reported failure or trigger caller retries.
  await Promise.allSettled([
    garbageCollectVaultRecords(VAULT_RECORDS_DIR, recordIds),
    attachmentStore().garbageCollect(attachmentReferences.values()),
  ])
}

function attachmentStore(): VaultAttachmentStore {
  // A fresh facade avoids stale in-memory usage accounting after an external
  // recovery/restore replaces the directory, while the storage-wide queue
  // continues to serialize every production operation.
  return new VaultAttachmentStore(VAULT_ATTACHMENTS_DIR)
}

async function writeBackupAttachmentBlobs(
  directory: string,
  blobs: ReadonlyMap<string, Buffer>,
  beforeCommit: () => void,
): Promise<void> {
  await ensurePrivateDir(directory)
  for (const [id, blob] of blobs) {
    validateContentId(id, 'attachment')
    beforeCommit()
    await atomicWritePrivateFile(join(directory, `${id}${VAULT_ATTACHMENT_FILE_EXTENSION}`), blob, {
      beforeCommit,
    })
  }
}

function hashBlobMap(blobs: ReadonlyMap<string, Buffer>): Record<string, string> {
  return Object.fromEntries(
    [...blobs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, blob]) => [id, sha256(blob)]),
  )
}

async function readBackupBlobMap(
  directory: string,
  hashesValue: unknown,
  extension: string,
  maxCount: number,
  maxBlobBytes: number,
  label: string,
): Promise<Map<string, Buffer>> {
  if (!hashesValue || typeof hashesValue !== 'object' || Array.isArray(hashesValue)) {
    throw new Error(`Backup ${label} map is invalid`)
  }
  const hashes = Object.entries(hashesValue as Record<string, unknown>)
  if (hashes.length > maxCount) throw new Error(`Backup contains too many ${label} blobs`)
  const blobs = new Map<string, Buffer>()
  let aggregateBytes = 0
  const aggregateLimit = label === 'attachment'
    ? 16 * 1024 * 1024
    : 64 * 1024 * 1024
  for (const [id, expectedHash] of hashes) {
    validateContentId(id, label)
    if (typeof expectedHash !== 'string' || !CONTENT_ID_RE.test(expectedHash)) {
      throw new Error(`Backup ${label} hash is invalid`)
    }
    const blob = await readRegularFile(join(directory, `${id}${extension}`), maxBlobBytes)
    aggregateBytes += blob.byteLength
    if (aggregateBytes > aggregateLimit) throw new Error(`Backup ${label} blobs are too large`)
    if (sha256(blob) !== expectedHash) throw new Error(`Backup integrity check failed for ${label} ${id}`)
    blobs.set(id, blob)
  }
  return blobs
}

function requireBackupBlobMap(
  value: Map<string, Buffer> | undefined,
  label: string,
): Map<string, Buffer> {
  if (!(value instanceof Map)) throw new Error(`Backup is missing its ${label} blob map`)
  return value
}

function validateContentId(value: string, label: string): string {
  if (!CONTENT_ID_RE.test(value)) throw new Error(`Backup ${label} identifier is invalid`)
  return value
}

/** Legacy single-file writers retained for compatibility with maintenance tools. */
export async function writeParams(raw: string): Promise<void> {
  validateParamsRaw(raw)
  await atomicWritePrivateFile(PARAMS_FILE, raw)
}

export async function writeWrappedKey(raw: Buffer): Promise<void> {
  await atomicWritePrivateFile(WRAPPED_KEY_FILE, raw)
}

export async function flushVaultOperations(): Promise<void> {
  await vaultOperationQueue.catch(() => undefined)
}

function enqueueVaultOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = vaultOperationQueue.catch(() => undefined).then(operation)
  vaultOperationQueue = run.then(() => undefined, () => undefined)
  return run
}

async function resolveActiveState(): Promise<ActiveAuthState> {
  const manifest = await readAuthStateManifest()
  if (manifest) return resolveManifestState(manifest)

  if (await getAuthStateStatus() !== 'ready') {
    throw new Error('Vault authentication state is incomplete')
  }
  const [paramsRaw, wrappedKey] = await Promise.all([
    readRegularFile(PARAMS_FILE, MAX_BACKUP_METADATA_BYTES).then(value => value.toString('utf8')),
    readRegularFile(WRAPPED_KEY_FILE, MAX_BACKUP_METADATA_BYTES),
  ])
  validateParamsRaw(paramsRaw)
  validateWrappedKey(wrappedKey)
  return { manifest: null, vaultPath: VAULT_FILE, paramsRaw, wrappedKey }
}

async function resolveManifestState(manifest: AuthStateManifest): Promise<ActiveAuthState> {
  const credentialsPath = safeStatePath(manifest.credentialsFile)
  const vaultPath = safeStatePath(manifest.vaultFile)
  const [credentialsRaw] = await Promise.all([
    readRegularFile(credentialsPath, MAX_BACKUP_METADATA_BYTES).then(value => value.toString('utf8')),
    fs.access(vaultPath),
  ])
  const credentials = parseCredentials(credentialsRaw)
  return {
    manifest,
    vaultPath,
    paramsRaw: credentials.paramsRaw,
    wrappedKey: credentials.wrappedKey,
  }
}

async function readAuthStateManifest(): Promise<AuthStateManifest | null> {
  let raw: string
  try {
    raw = (await readRegularFile(AUTH_STATE_MANIFEST_FILE, MAX_BACKUP_METADATA_BYTES)).toString('utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed.format !== STATE_FORMAT) throw new Error('Invalid auth-state manifest format')
  const generation = safeGeneration(parsed.generation)
  const vaultFile = safeStateFilename(parsed.vaultFile, 'vault')
  const credentialsFile = safeStateFilename(parsed.credentialsFile, 'credentials')
  return { format: STATE_FORMAT, generation, vaultFile, credentialsFile }
}

function serializeManifest(input: Omit<AuthStateManifest, 'format'>): string {
  return `${JSON.stringify({ format: STATE_FORMAT, ...input }, null, 2)}\n`
}

function serializeCredentials(paramsRaw: string, wrappedKey: Buffer): string {
  validateParamsRaw(paramsRaw)
  return `${JSON.stringify({
    format: CREDENTIALS_FORMAT,
    paramsRaw,
    wrappedKey: wrappedKey.toString('base64'),
  }, null, 2)}\n`
}

function parseCredentials(raw: string): { paramsRaw: string; wrappedKey: Buffer } {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed.format !== CREDENTIALS_FORMAT || typeof parsed.paramsRaw !== 'string') {
    throw new Error('Invalid credentials bundle')
  }
  if (typeof parsed.wrappedKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.wrappedKey)) {
    throw new Error('Invalid wrapped key in credentials bundle')
  }
  validateParamsRaw(parsed.paramsRaw)
  const wrappedKey = Buffer.from(parsed.wrappedKey, 'base64')
  validateWrappedKey(wrappedKey)
  return { paramsRaw: parsed.paramsRaw, wrappedKey }
}

function validateParamsRaw(raw: string): void {
  if (Buffer.byteLength(raw, 'utf8') > MAX_BACKUP_METADATA_BYTES) throw new Error('Parameters file is too large')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed.version !== 2 || !parsed.scrypt || typeof parsed.scrypt !== 'object') {
    throw new Error('Invalid vault parameters')
  }
}

function safeStatePath(filename: string): string {
  return join(VAULT_DIR, safeStateFilename(filename, 'state'))
}

function safeStateFilename(value: unknown, label: string): string {
  if (typeof value !== 'string' || basename(value) !== value || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) {
    throw new Error(`Invalid ${label} state filename`)
  }
  return value
}

function safeGeneration(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) {
    throw new Error('Invalid auth-state generation')
  }
  return value
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  let handle: fs.FileHandle | null = null
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(path, fsConstants.O_RDONLY | noFollow)
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Entry must be a regular file: ${basename(path)}`)
    if (stat.size < 1 || stat.size > maxBytes) throw new Error(`Entry has an invalid size: ${basename(path)}`)
    return await handle.readFile()
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function validateWrappedKey(wrappedKey: Buffer): void {
  if (wrappedKey.length < 29 || wrappedKey.length > MAX_BACKUP_METADATA_BYTES) {
    throw new Error('Invalid wrapped key length')
  }
}

function validatePersistedVaultJson(json: string): Record<string, unknown> {
  if (Buffer.byteLength(json, 'utf8') > VAULT_VALIDATION_LIMITS.maxJsonBytes) {
    throw new VaultValidationError('$', 'limit', 'exceeds the maximum decrypted payload size')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    // Do not forward JSON.parse diagnostics: newer runtimes can include a
    // plaintext excerpt from the rejected payload in their error message.
    throw new VaultValidationError('$', 'json', 'is not valid JSON')
  }
  validateVaultRoot(parsed, { boundary: 'persisted' })
  return parsed
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
