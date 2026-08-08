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
  measureVaultRecordBlobBytes,
  readVaultRecordBlobs,
  validateVaultRecordManifest,
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
import {
  parseRecoveryEnvelope,
  serializeRecoveryEnvelope,
  type RecoveryKitEnvelope,
} from './recoveryKit'
import { DEFAULT_LOCAL_FOLDERS } from '../shared/defaultLocalFolders'
import {
  createVaultCollectionManifest,
  findVaultCollectionMutationReceipt,
  isVaultCollectionManifest,
  requireVaultCollectionEntry,
  summarizeVaultCollection,
  validateExactVaultId,
  validateNewVaultName,
  validateVaultCollectionManifest,
  withVaultCollectionMutationReceipt,
  type VaultCollectionMutationType,
  type VaultCollectionManifest,
  type VaultCollectionSummary,
} from './vaultCollection'
import {
  MAX_VAULT_COLLECTION_ATTACHMENTS,
  MAX_VAULT_COLLECTION_ATTACHMENT_BYTES,
  measureVaultAttachmentBlobBytes,
} from './vaultCollectionLimits'
import { migrateLegacyVaultMutationReceipts } from './vaultMutationReceipts'

export const VAULT_DIR = join(app.getPath('userData'), 'vault-data')
export const VAULT_FILE = join(VAULT_DIR, 'vault.enc')
export const WRAPPED_KEY_FILE = join(VAULT_DIR, 'key.wrapped')
export const PARAMS_FILE = join(VAULT_DIR, 'params.json')
export const AUDIT_LOG_FILE = join(VAULT_DIR, 'audit.log')
export const AUTH_STATE_MANIFEST_FILE = join(VAULT_DIR, 'auth-state.json')
export const BACKUP_MANIFEST_FILE = 'vaultage-backup.json'
export const VAULT_RECORDS_DIR = join(VAULT_DIR, 'records')
export const VAULT_ATTACHMENTS_DIR = join(VAULT_DIR, 'attachments')

const LEGACY_STATE_FORMAT = 'vaultage.auth-state.v1'
const STATE_FORMAT = 'vaultage.auth-state.v2'
const CREDENTIALS_FORMAT = 'vaultage.credentials.v1'
const LEGACY_BACKUP_FORMAT = 'vaultage.backup.v1'
const PRIOR_BACKUP_FORMAT = 'vaultage.backup.v2'
const BACKUP_FORMAT = 'vaultage.backup.v3'
const MAX_BACKUP_VAULT_BYTES = 20 * 1024 * 1024
const MAX_BACKUP_METADATA_BYTES = 64 * 1024
const MAX_BACKUP_MANIFEST_BYTES = 64 * 1024 * 1024
const MAX_VAULT_COLLECTION_RECORDS = 250_000
const MAX_VAULT_COLLECTION_RECORD_BYTES = 256 * 1024 * 1024
const MAX_VAULT_COLLECTION_MANIFEST_BYTES = VAULT_VALIDATION_LIMITS.maxJsonBytes
const RECORD_BACKUP_DIR = 'records'
const ATTACHMENT_BACKUP_DIR = 'attachments'
const RECOVERY_BACKUP_FILE = 'recovery.json'
const CONTENT_ID_RE = /^[0-9a-f]{64}$/

let vaultOperationQueue = Promise.resolve()

export type AuthStateStatus = 'missing' | 'ready' | 'incomplete'

export interface VaultBackupSnapshot {
  format?: typeof LEGACY_BACKUP_FORMAT | typeof PRIOR_BACKUP_FORMAT | typeof BACKUP_FORMAT
  paramsRaw: string
  wrappedKey: Buffer
  vaultBlob: Buffer
  recoveryEnvelope?: RecoveryKitEnvelope
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

export interface VaultCollectionMutationRequest {
  operationId: string
  expectedRevision: number
  fingerprint: string
}

export interface VaultCollectionOperationOptions {
  assertCurrent?: () => void
  mutation?: VaultCollectionMutationRequest
}

interface VaultCollectionMutationPlan extends VaultCollectionMutationRequest {
  type: VaultCollectionMutationType
  targetVaultId: string
}

export interface VaultCollectionCommitSummary extends VaultCollectionSummary {
  alreadyCommitted?: boolean
}

export class StaleVaultCollectionMutationError extends Error {
  constructor(readonly currentCollection: VaultCollectionSummary) {
    super('Vault collection revision is stale')
  }
}

interface AuthStateManifest {
  format: typeof LEGACY_STATE_FORMAT | typeof STATE_FORMAT
  generation: string
  vaultFile: string
  credentialsFile: string
  recoveryFile?: string
}

interface ActiveAuthState {
  manifest: AuthStateManifest | null
  vaultPath: string
  paramsRaw: string
  wrappedKey: Buffer
  recoveryEnvelope: RecoveryKitEnvelope | null
}

interface LoadedVaultState {
  vault: Record<string, unknown>
  persistedVault: Record<string, unknown>
  recordIds: Set<string>
  attachmentReferences: Map<string, VaultAttachmentReference>
  vaultBlob: Buffer
  legacy: boolean
  collection: VaultCollectionManifest | null
  vaultsById: Map<string, DecodedVaultEntry>
  legacyRecordManifest: VaultRecordManifest | null
}

interface DecodedVaultEntry {
  vault: Record<string, unknown>
  persistedVault: Record<string, unknown>
  recordIds: Set<string>
  attachmentReferences: Map<string, VaultAttachmentReference>
}

interface PreparedVaultState {
  persistedVault: Record<string, unknown>
  manifest: VaultRecordManifest
  recordIds: Set<string>
  attachmentReferences: Map<string, VaultAttachmentReference>
  vaultBlob: Buffer
}

interface PreparedVaultCollectionState {
  collection: VaultCollectionManifest
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

export async function readRecoveryEnvelope(): Promise<RecoveryKitEnvelope | null> {
  const state = await resolveActiveState()
  return state.recoveryEnvelope ? parseRecoveryEnvelope(state.recoveryEnvelope) : null
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
  input: {
    paramsRaw: string
    wrappedKey: Buffer
    vaultJson: string
    vaultKey: Buffer
    recoveryEnvelope?: RecoveryKitEnvelope
  },
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
      const preparedVault = await prepareVaultState(initialVault, keyLease.key)
      const initialVaultId = vaultRootId(preparedVault.persistedVault)
      const prepared = await prepareVaultCollectionState(
        createVaultCollectionManifest({
          id: initialVaultId,
          manifest: preparedVault.manifest,
          now: new Date().toISOString(),
        }),
        preparedVault.recordIds,
        preparedVault.attachmentReferences,
        keyLease.key,
      )
      assertCurrent()
      keyLease.assertCurrent()
      const generation = randomUUID()
      const vaultFile = `vault.${generation}.enc`
      const credentialsFile = `credentials.${generation}.json`
      const recoveryEnvelope = input.recoveryEnvelope
        ? parseRecoveryEnvelope(input.recoveryEnvelope)
        : null
      const recoveryFile = recoveryEnvelope ? `recovery.${generation}.json` : undefined
      const vaultPath = join(VAULT_DIR, vaultFile)
      const credentialsPath = join(VAULT_DIR, credentialsFile)
      const recoveryPath = recoveryFile ? join(VAULT_DIR, recoveryFile) : null
      const credentialsRaw = serializeCredentials(input.paramsRaw, input.wrappedKey)

      try {
        await atomicWritePrivateFile(vaultPath, prepared.vaultBlob, {
          beforeCommit: () => {
            assertCurrent()
            keyLease.assertCurrent()
          },
        })
        await atomicWritePrivateFile(credentialsPath, credentialsRaw, { beforeCommit: assertCurrent })
        if (recoveryEnvelope && recoveryPath) {
          await atomicWritePrivateFile(
            recoveryPath,
            serializeRecoveryEnvelope(recoveryEnvelope),
            { beforeCommit: assertCurrent },
          )
        }
        await atomicWritePrivateFile(
          AUTH_STATE_MANIFEST_FILE,
          serializeManifest({
            generation,
            vaultFile,
            credentialsFile,
            ...(recoveryFile ? { recoveryFile } : {}),
          }),
          { beforeCommit: assertCurrent },
        )
        await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
      } catch (err) {
        await Promise.all([
          fs.rm(vaultPath, { force: true }),
          fs.rm(credentialsPath, { force: true }),
          recoveryPath ? fs.rm(recoveryPath, { force: true }) : Promise.resolve(),
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
      const recoveryFile = active.manifest?.recoveryFile
      await atomicWritePrivateFile(
        AUTH_STATE_MANIFEST_FILE,
        serializeManifest({
          generation,
          vaultFile,
          credentialsFile,
          ...(recoveryFile ? { recoveryFile } : {}),
        }),
        { beforeCommit: assertCurrent },
      )
      await garbageCollectAuthStateFiles({ vaultFile, credentialsFile, recoveryFile })
    } catch (err) {
      await fs.rm(credentialsPath, { force: true }).catch(() => undefined)
      throw err
    }
  })
}

export async function commitRecoveryEnvelope(
  recoveryEnvelope: RecoveryKitEnvelope | null,
  assertCurrent: () => void = () => undefined,
): Promise<void> {
  await enqueueVaultOperation(async () => {
    await ensureVaultDir()
    const active = await resolveActiveState()
    assertCurrent()
    const generation = randomUUID()
    const credentialsFile = `credentials.${generation}.json`
    const credentialsPath = join(VAULT_DIR, credentialsFile)
    const recoveryFile = recoveryEnvelope ? `recovery.${generation}.json` : undefined
    const recoveryPath = recoveryFile ? join(VAULT_DIR, recoveryFile) : null
    const vaultFile = active.manifest?.vaultFile ?? basename(active.vaultPath)
    try {
      await atomicWritePrivateFile(
        credentialsPath,
        serializeCredentials(active.paramsRaw, active.wrappedKey),
        { beforeCommit: assertCurrent },
      )
      if (recoveryEnvelope && recoveryPath) {
        await atomicWritePrivateFile(
          recoveryPath,
          serializeRecoveryEnvelope(recoveryEnvelope),
          { beforeCommit: assertCurrent },
        )
      }
      await atomicWritePrivateFile(
        AUTH_STATE_MANIFEST_FILE,
        serializeManifest({
          generation,
          vaultFile,
          credentialsFile,
          ...(recoveryFile ? { recoveryFile } : {}),
        }),
        { beforeCommit: assertCurrent },
      )
      await garbageCollectAuthStateFiles({ vaultFile, credentialsFile, recoveryFile })
    } catch (err) {
      await Promise.all([
        fs.rm(credentialsPath, { force: true }),
        recoveryPath ? fs.rm(recoveryPath, { force: true }) : Promise.resolve(),
      ]).catch(() => undefined)
      throw err
    }
  })
}

export async function commitAuthAndRecoveryCredentials(
  paramsRaw: string,
  wrappedKey: Buffer,
  recoveryEnvelope: RecoveryKitEnvelope,
  assertCurrent: () => void = () => undefined,
): Promise<void> {
  await enqueueVaultOperation(async () => {
    await ensureVaultDir()
    const active = await resolveActiveState()
    assertCurrent()
    validateParamsRaw(paramsRaw)
    const safeEnvelope = parseRecoveryEnvelope(recoveryEnvelope)
    const generation = randomUUID()
    const credentialsFile = `credentials.${generation}.json`
    const recoveryFile = `recovery.${generation}.json`
    const credentialsPath = join(VAULT_DIR, credentialsFile)
    const recoveryPath = join(VAULT_DIR, recoveryFile)
    const vaultFile = active.manifest?.vaultFile ?? basename(active.vaultPath)
    try {
      await atomicWritePrivateFile(credentialsPath, serializeCredentials(paramsRaw, wrappedKey), {
        beforeCommit: assertCurrent,
      })
      await atomicWritePrivateFile(recoveryPath, serializeRecoveryEnvelope(safeEnvelope), {
        beforeCommit: assertCurrent,
      })
      await atomicWritePrivateFile(
        AUTH_STATE_MANIFEST_FILE,
        serializeManifest({ generation, vaultFile, credentialsFile, recoveryFile }),
        { beforeCommit: assertCurrent },
      )
      await garbageCollectAuthStateFiles({ vaultFile, credentialsFile, recoveryFile })
    } catch (err) {
      await Promise.all([
        fs.rm(credentialsPath, { force: true }),
        fs.rm(recoveryPath, { force: true }),
      ]).catch(() => undefined)
      throw err
    }
  })
}

export async function readVault(
  key: Buffer,
  options: { assertCurrent?: () => void; vaultId?: string } = {},
): Promise<unknown> {
  const keyLease = leaseVaultKey(key)
  const assertCurrent = () => {
    keyLease.assertCurrent()
    options.assertCurrent?.()
  }
  try {
    return await enqueueVaultOperation(async () => {
      assertCurrent()
      const state = await resolveActiveState()
      const loaded = await readVaultFile(state.vaultPath, keyLease.key)
      assertCurrent()
      requireActiveVaultId(loaded, options.vaultId)

      // Authenticated single-vault documents and record manifests are wrapped
      // in one encrypted collection manifest. Record blobs are committed first
      // and the encrypted collection replaces the old ciphertext last, so an
      // interruption leaves the exact legacy state readable and may create
      // only age-gated orphan blobs.
      if (loaded.legacy) {
        const prepared = await prepareLegacyVaultCollection(loaded, keyLease.key)
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
          beforeCommit: assertCurrent,
        })
        await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
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
      const prepared = await prepareUpdatedActiveVault(current, vault, keyLease.key)
      await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
        beforeCommit: keyLease.assertCurrent,
      })
      await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
    })
  } finally {
    keyLease.release()
  }
}

export async function updateVault<T>(
  key: Buffer,
  updater: (vault: unknown) => { json: string; result: T } | Promise<{ json: string; result: T }>,
  options: {
    assertCurrent?: () => void
    assertCurrentAsync?: () => Promise<void>
    vaultId?: string
  } = {},
): Promise<T> {
  const outcome = await commitVaultUpdate(key, updater, options)
  return outcome.value
}

export async function commitVaultUpdate<T>(
  key: Buffer,
  updater: (vault: unknown) => { json: string; result: T } | Promise<{ json: string; result: T }>,
  options: {
    assertCurrent?: () => void
    assertCurrentAsync?: () => Promise<void>
    vaultId?: string
  } = {},
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
      requireActiveVaultId(current, options.vaultId)
      const { json, result } = await updater(current.vault)
      assertCurrent()
      const vault = validatePersistedVaultJson(json)
      const prepared = await prepareUpdatedActiveVault(current, vault, keyLease.key)
      assertCurrent()
      await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
        beforeCommit: async () => {
          assertCurrent()
          await options.assertCurrentAsync?.()
          assertCurrent()
        },
      })
      await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
      return { status: 'committed', value: result }
    })
  } finally {
    keyLease.release()
  }
}

export async function readVaultCollection(key: Buffer): Promise<VaultCollectionSummary> {
  const keyLease = leaseVaultKey(key)
  try {
    return await enqueueVaultOperation(async () => {
      keyLease.assertCurrent()
      const state = await resolveActiveState()
      const loaded = await readVaultFile(state.vaultPath, keyLease.key)
      const prepared = loaded.collection
        ? null
        : await prepareLegacyVaultCollection(loaded, keyLease.key)
      if (prepared) {
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
          beforeCommit: keyLease.assertCurrent,
        })
        await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
      }
      return summarizeVaultCollection(prepared?.collection ?? loaded.collection!)
    })
  } finally {
    keyLease.release()
  }
}

/**
 * `includeArchived` is intentionally main-internal only. It lets authenticated
 * audit reconciliation drain a durable receipt after the user archives its
 * vault; renderer IPC never exposes that option.
 */
export async function readVaultById(
  key: Buffer,
  vaultIdValue: unknown,
  options: { includeArchived?: boolean } = {},
): Promise<unknown> {
  const vaultId = validateExactVaultId(vaultIdValue)
  const keyLease = leaseVaultKey(key)
  try {
    return await enqueueVaultOperation(async () => {
      keyLease.assertCurrent()
      const state = await resolveActiveState()
      let loaded = await readVaultFile(state.vaultPath, keyLease.key)
      if (!loaded.collection) {
        const prepared = await prepareLegacyVaultCollection(loaded, keyLease.key)
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
          beforeCommit: keyLease.assertCurrent,
        })
        await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
        loaded = await readVaultFile(state.vaultPath, keyLease.key)
      }
      const entry = requireVaultCollectionEntry(loaded.collection!, vaultId)
      if (entry.archived && !options.includeArchived) throw new Error('Vault is archived')
      const decoded = loaded.vaultsById.get(entry.id)
      if (!decoded) throw new Error('Vault does not exist')
      return entry.id === loaded.collection!.activeVaultId
        ? loaded.vault
        : hydratePersistedVault(decoded.persistedVault, keyLease.key)
    })
  } finally {
    keyLease.release()
  }
}

export async function createVault(
  key: Buffer,
  nameValue: unknown,
  options: VaultCollectionOperationOptions & { id?: string; now?: string } = {},
): Promise<VaultCollectionCommitSummary> {
  const name = validateNewVaultName(nameValue)
  const vaultId = validateExactVaultId(options.id ?? randomUUID())
  return commitVaultCollectionChange(key, async (_loaded, base, assertCurrent) => {
    if (base.collection.vaults.some(entry => entry.id === vaultId)) {
      throw new Error('Vault already exists')
    }
    const now = options.now ?? new Date().toISOString()
    const folders = DEFAULT_LOCAL_FOLDERS.map(folder => ({
      id: `${vaultId}-${folder.slug}`,
      name: folder.name,
      children: [],
      secrets: [],
      itemOrder: [],
    }))
    const vault: Record<string, unknown> = {
      version: 2,
      revision: 1,
      root: {
        id: vaultId,
        name,
        children: folders,
        secrets: [],
        itemOrder: folders.map(folder => ({ kind: 'folder', id: folder.id })),
      },
      providers: [],
      providerGroups: [],
      envProjects: [],
      preferences: { localDefaultFoldersCreated: true },
    }
    const preparedVault = await prepareVaultState(vault, key, base.recordIds)
    assertCurrent()
    const collection = validateVaultCollectionManifest({
      ...base.collection,
      revision: base.collection.revision + 1,
      activeVaultId: vaultId,
      vaults: [...base.collection.vaults, {
        id: vaultId,
        name,
        createdAt: now,
        updatedAt: now,
        archived: false,
        manifest: preparedVault.manifest,
      }],
    })
    return prepareVaultCollectionState(
      collection,
      new Set([...base.recordIds, ...preparedVault.recordIds]),
      new Map([...base.attachmentReferences, ...preparedVault.attachmentReferences]),
      key,
    )
  }, collectionOperationOptions(options, 'create', vaultId))
}

export async function switchActiveVault(
  key: Buffer,
  vaultIdValue: unknown,
  options: VaultCollectionOperationOptions = {},
): Promise<VaultCollectionCommitSummary> {
  const vaultId = validateExactVaultId(vaultIdValue)
  return commitVaultCollectionChange(key, async (loaded, base) => {
    const entry = requireVaultCollectionEntry(base.collection, vaultId)
    if (entry.archived) throw new Error('Vault is archived')
    if (base.collection.activeVaultId === vaultId) return base
    const target = loaded.vaultsById.get(vaultId)
    if (!target) throw new Error('Vault does not exist')
    // Validate the complete target, including authenticated attachment blobs,
    // before the durable active id changes. A broken inactive entry must never
    // become the state that every subsequent read attempts to hydrate.
    await hydratePersistedVault(target.persistedVault, key)
    return prepareVaultCollectionState(
      validateVaultCollectionManifest({
        ...base.collection,
        revision: base.collection.revision + 1,
        activeVaultId: vaultId,
      }),
      base.recordIds,
      base.attachmentReferences,
      key,
    )
  }, collectionOperationOptions(options, 'switch', vaultId))
}

export async function renameVault(
  key: Buffer,
  vaultIdValue: unknown,
  nameValue: unknown,
  options: VaultCollectionOperationOptions & { now?: string } = {},
): Promise<VaultCollectionCommitSummary> {
  const vaultId = validateExactVaultId(vaultIdValue)
  const name = validateNewVaultName(nameValue)
  return commitVaultCollectionChange(key, async (_loaded, base) => {
    requireVaultCollectionEntry(base.collection, vaultId)
    const now = options.now ?? new Date().toISOString()
    return prepareVaultCollectionState(
      validateVaultCollectionManifest({
        ...base.collection,
        revision: base.collection.revision + 1,
        vaults: base.collection.vaults.map(entry => entry.id === vaultId
          ? { ...entry, name, updatedAt: now }
          : entry),
      }),
      base.recordIds,
      base.attachmentReferences,
      key,
    )
  }, collectionOperationOptions(options, 'rename', vaultId))
}

export async function setVaultArchived(
  key: Buffer,
  vaultIdValue: unknown,
  archived: boolean,
  options: VaultCollectionOperationOptions & { now?: string } = {},
): Promise<VaultCollectionCommitSummary> {
  const vaultId = validateExactVaultId(vaultIdValue)
  return commitVaultCollectionChange(key, async (_loaded, base) => {
    const entry = requireVaultCollectionEntry(base.collection, vaultId)
    if (archived && entry.id === base.collection.activeVaultId) {
      throw new Error('Switch away from the active vault before archiving it')
    }
    if (archived && base.collection.vaults.filter(candidate => !candidate.archived).length <= 1) {
      throw new Error('The final available vault cannot be archived')
    }
    if (entry.archived === archived) return base
    const now = options.now ?? new Date().toISOString()
    return prepareVaultCollectionState(
      validateVaultCollectionManifest({
        ...base.collection,
        revision: base.collection.revision + 1,
        vaults: base.collection.vaults.map(candidate => candidate.id === vaultId
          ? { ...candidate, archived, updatedAt: now }
          : candidate),
      }),
      base.recordIds,
      base.attachmentReferences,
      key,
    )
  }, collectionOperationOptions(options, 'archive', vaultId))
}

export async function deleteVault(
  key: Buffer,
  vaultIdValue: unknown,
  options: VaultCollectionOperationOptions = {},
): Promise<VaultCollectionCommitSummary> {
  const vaultId = validateExactVaultId(vaultIdValue)
  return commitVaultCollectionChange(key, async (loaded, base) => {
    const entry = requireVaultCollectionEntry(base.collection, vaultId)
    if (entry.id === base.collection.activeVaultId) throw new Error('The active vault cannot be deleted')
    if (base.collection.vaults.length <= 1) throw new Error('The final vault cannot be deleted')
    if (!entry.archived) throw new Error('Archive the vault before deleting it')
    if (!loaded.vaultsById.has(vaultId)) throw new Error('Vault does not exist')
    // Rebuild the retained union rather than subtracting the removed entry:
    // content-addressed records and attachments may be shared byte-for-byte
    // by more than one vault and must remain referenced by every survivor.
    const recordIds = new Set<string>()
    const attachmentReferences = new Map<string, VaultAttachmentReference>()
    for (const [id, decoded] of loaded.vaultsById) {
      if (id === vaultId) continue
      for (const recordId of decoded.recordIds) recordIds.add(recordId)
      for (const [referenceId, reference] of decoded.attachmentReferences) {
        attachmentReferences.set(referenceId, reference)
      }
    }
    return prepareVaultCollectionState(
      validateVaultCollectionManifest({
        ...base.collection,
        revision: base.collection.revision + 1,
        vaults: base.collection.vaults.filter(candidate => candidate.id !== vaultId),
      }),
      recordIds,
      attachmentReferences,
      key,
    )
  }, collectionOperationOptions(options, 'delete', vaultId))
}

async function commitVaultCollectionChange(
  key: Buffer,
  change: (
    loaded: LoadedVaultState,
    base: PreparedVaultCollectionState,
    assertCurrent: () => void,
  ) => Promise<PreparedVaultCollectionState>,
  options: { assertCurrent?: () => void; mutation?: VaultCollectionMutationPlan },
): Promise<VaultCollectionCommitSummary> {
  const keyLease = leaseVaultKey(key)
  const assertCurrent = () => {
    keyLease.assertCurrent()
    options.assertCurrent?.()
  }
  try {
    return await enqueueVaultOperation(async () => {
      assertCurrent()
      const state = await resolveActiveState()
      const loaded = await readVaultFile(state.vaultPath, keyLease.key)
      const base = loaded.collection
        ? await prepareVaultCollectionState(
            loaded.collection,
            new Set(loaded.recordIds),
            new Map(loaded.attachmentReferences),
            keyLease.key,
          )
        : await prepareLegacyVaultCollection(loaded, keyLease.key)
      const mutation = options.mutation
      if (mutation) {
        const prior = findVaultCollectionMutationReceipt(base.collection, mutation)
        if (prior) return { ...prior.result, alreadyCommitted: true }
        if (mutation.expectedRevision !== base.collection.revision) {
          throw new StaleVaultCollectionMutationError(summarizeVaultCollection(base.collection))
        }
      }
      let prepared = await change(loaded, base, assertCurrent)
      if (mutation) {
        const received = withVaultCollectionMutationReceipt(prepared.collection, {
          ...mutation,
          type: mutation.type,
          targetVaultId: mutation.targetVaultId,
        })
        prepared = await prepareVaultCollectionState(
          received.collection,
          prepared.recordIds,
          prepared.attachmentReferences,
          keyLease.key,
        )
      }
      assertCurrent()
      if (!prepared.vaultBlob.equals(loaded.vaultBlob)) {
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, { beforeCommit: assertCurrent })
        await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
      }
      return summarizeVaultCollection(prepared.collection)
    })
  } finally {
    keyLease.release()
  }
}

function collectionOperationOptions(
  options: VaultCollectionOperationOptions,
  type: VaultCollectionMutationType,
  targetVaultId: string,
): VaultCollectionOperationOptions & {
  mutation?: VaultCollectionMutationPlan
} {
  if (!options.mutation) return { assertCurrent: options.assertCurrent }
  return {
    ...options,
    mutation: { ...options.mutation, type, targetVaultId },
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
        const prepared = await prepareLegacyVaultCollection(loaded, keyLease.key)
        await atomicWritePrivateFile(state.vaultPath, prepared.vaultBlob, {
          beforeCommit: keyLease.assertCurrent,
        })
        await garbageCollectCommittedReferences(prepared.recordIds, prepared.attachmentReferences)
        loaded = await readVaultFile(state.vaultPath, keyLease.key)
      }
      keyLease.assertCurrent()

      const recordBlobs = await readVaultRecordBlobs(
        VAULT_RECORDS_DIR,
        loaded.recordIds,
        MAX_VAULT_COLLECTION_RECORDS,
        MAX_VAULT_COLLECTION_RECORD_BYTES,
      )
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
      const recoveryBuffer = state.recoveryEnvelope
        ? Buffer.from(serializeRecoveryEnvelope(state.recoveryEnvelope), 'utf8')
        : null
      if (recoveryBuffer) {
        await atomicWritePrivateFile(join(targetDir, RECOVERY_BACKUP_FILE), recoveryBuffer, {
          beforeCommit: keyLease.assertCurrent,
        })
      }
      await writeVaultRecordBlobs(
        join(targetDir, RECORD_BACKUP_DIR),
        recordBlobs,
        keyLease.assertCurrent,
        MAX_VAULT_COLLECTION_RECORDS,
        MAX_VAULT_COLLECTION_RECORD_BYTES,
      )
      await writeBackupAttachmentBlobs(
        join(targetDir, ATTACHMENT_BACKUP_DIR),
        attachmentBlobs,
        keyLease.assertCurrent,
      )
      const files: Record<string, string> = {
        'vault.enc': sha256(loaded.vaultBlob),
        'key.wrapped': sha256(state.wrappedKey),
        'params.json': sha256(Buffer.from(state.paramsRaw, 'utf8')),
      }
      if (recoveryBuffer) files[RECOVERY_BACKUP_FILE] = sha256(recoveryBuffer)
      const manifest = {
        format: BACKUP_FORMAT,
        createdAt: new Date().toISOString(),
        files,
        records: hashBlobMap(recordBlobs),
        attachments: hashBlobMap(attachmentBlobs),
      }
      const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`
      if (Buffer.byteLength(manifestRaw, 'utf8') > MAX_BACKUP_MANIFEST_BYTES) {
        throw new Error('Vaultage backup manifest is too large')
      }
      await atomicWritePrivateFile(
        join(targetDir, BACKUP_MANIFEST_FILE),
        manifestRaw,
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
    (
      manifest.format !== BACKUP_FORMAT
      && manifest.format !== PRIOR_BACKUP_FORMAT
      && manifest.format !== LEGACY_BACKUP_FORMAT
    )
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
  let recoveryEnvelope: RecoveryKitEnvelope | undefined
  if (manifest.format === BACKUP_FORMAT && manifest.files[RECOVERY_BACKUP_FILE] !== undefined) {
    const expectedHash = manifest.files[RECOVERY_BACKUP_FILE]
    if (typeof expectedHash !== 'string' || !CONTENT_ID_RE.test(expectedHash)) {
      throw new Error('Backup recovery-envelope hash is invalid')
    }
    const recoveryBuffer = await readRegularFile(
      join(sourceDir, RECOVERY_BACKUP_FILE),
      MAX_BACKUP_METADATA_BYTES,
    )
    if (sha256(recoveryBuffer) !== expectedHash) {
      throw new Error(`Backup integrity check failed for ${RECOVERY_BACKUP_FILE}`)
    }
    recoveryEnvelope = parseRecoveryEnvelope(JSON.parse(recoveryBuffer.toString('utf8')))
  }
  const recordBlobs = await readBackupBlobMap(
    join(sourceDir, RECORD_BACKUP_DIR),
    manifest.records,
    {
      extension: VAULT_RECORD_FILE_EXTENSION,
      maxCount: MAX_VAULT_COLLECTION_RECORDS,
      maxBlobBytes: MAX_VAULT_RECORD_BLOB_BYTES,
      maxAggregateBytes: MAX_VAULT_COLLECTION_RECORD_BYTES,
      label: 'record',
    },
  )
  const attachmentBlobs = await readBackupBlobMap(
    join(sourceDir, ATTACHMENT_BACKUP_DIR),
    manifest.attachments,
    {
      extension: VAULT_ATTACHMENT_FILE_EXTENSION,
      maxCount: MAX_VAULT_COLLECTION_ATTACHMENTS,
      maxBlobBytes: VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes,
      maxAggregateBytes: MAX_VAULT_COLLECTION_ATTACHMENT_BYTES,
      label: 'attachment',
    },
  )
  return {
    format: manifest.format,
    paramsRaw,
    wrappedKey,
    vaultBlob,
    ...(recoveryEnvelope ? { recoveryEnvelope } : {}),
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
  replacement?: {
    paramsRaw: string
    wrappedKey: Buffer
    recoveryEnvelope: RecoveryKitEnvelope
  },
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
      const committedParamsRaw = replacement?.paramsRaw ?? snapshot.paramsRaw
      const committedWrappedKey = replacement?.wrappedKey ?? snapshot.wrappedKey
      validateParamsRaw(committedParamsRaw)
      validateWrappedKey(committedWrappedKey)
      const decoded = await decodeVaultBackupSnapshot(snapshot, keyLease.key)
      assertRestoreCurrent()

      let vaultBlob: Buffer
      let recordIds: Set<string>
      let attachmentReferences: Map<string, VaultAttachmentReference>
      if (snapshot.format === BACKUP_FORMAT || snapshot.format === PRIOR_BACKUP_FORMAT) {
        const recordBlobs = requireBackupBlobMap(snapshot.recordBlobs, 'record')
        const attachmentBlobs = requireBackupBlobMap(snapshot.attachmentBlobs, 'attachment')
        await writeVaultRecordBlobs(
          VAULT_RECORDS_DIR,
          recordBlobs,
          assertRestoreCurrent,
          MAX_VAULT_COLLECTION_RECORDS,
          MAX_VAULT_COLLECTION_RECORD_BYTES,
        )
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
        const preparedVault = await prepareVaultState(decoded.vault, keyLease.key)
        const prepared = await prepareVaultCollectionState(
          createVaultCollectionManifest({
            id: vaultRootId(preparedVault.persistedVault),
            manifest: preparedVault.manifest,
            now: new Date().toISOString(),
          }),
          preparedVault.recordIds,
          preparedVault.attachmentReferences,
          keyLease.key,
        )
        assertRestoreCurrent()
        vaultBlob = prepared.vaultBlob
        recordIds = prepared.recordIds
        attachmentReferences = prepared.attachmentReferences
      }

      const generation = randomUUID()
      const vaultFile = `vault.${generation}.enc`
      const credentialsFile = `credentials.${generation}.json`
      const currentRecovery = replacement?.recoveryEnvelope ?? snapshot.recoveryEnvelope
        ?? (await resolveActiveState().catch(() => null))?.recoveryEnvelope
      const recoveryFile = currentRecovery ? `recovery.${generation}.json` : undefined
      const vaultPath = join(VAULT_DIR, vaultFile)
      const credentialsPath = join(VAULT_DIR, credentialsFile)
      const recoveryPath = recoveryFile ? join(VAULT_DIR, recoveryFile) : null
      try {
        await atomicWritePrivateFile(vaultPath, vaultBlob, { beforeCommit: assertRestoreCurrent })
        await atomicWritePrivateFile(
          credentialsPath,
          serializeCredentials(committedParamsRaw, committedWrappedKey),
          { beforeCommit: assertRestoreCurrent },
        )
        if (currentRecovery && recoveryPath) {
          await atomicWritePrivateFile(
            recoveryPath,
            serializeRecoveryEnvelope(currentRecovery),
            { beforeCommit: assertRestoreCurrent },
          )
        }
        await atomicWritePrivateFile(
          AUTH_STATE_MANIFEST_FILE,
          serializeManifest({
            generation,
            vaultFile,
            credentialsFile,
            ...(recoveryFile ? { recoveryFile } : {}),
          }),
          { beforeCommit: assertRestoreCurrent },
        )
        await garbageCollectAuthStateFiles({ vaultFile, credentialsFile, recoveryFile })
        await garbageCollectCommittedReferences(recordIds, attachmentReferences)
      } catch (err) {
        await Promise.all([
          fs.rm(vaultPath, { force: true }),
          fs.rm(credentialsPath, { force: true }),
          recoveryPath ? fs.rm(recoveryPath, { force: true }) : Promise.resolve(),
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

async function prepareVaultCollectionState(
  collectionValue: VaultCollectionManifest,
  recordIds: Set<string>,
  attachmentReferences: Map<string, VaultAttachmentReference>,
  vaultKey: Buffer,
): Promise<PreparedVaultCollectionState> {
  const collection = validateVaultCollectionManifest(collectionValue)
  const manifestJson = JSON.stringify(collection)
  if (Buffer.byteLength(manifestJson, 'utf8') > MAX_VAULT_COLLECTION_MANIFEST_BYTES) {
    throw new Error('Vault collection manifest is too large')
  }
  if (recordIds.size > MAX_VAULT_COLLECTION_RECORDS) {
    throw new Error('Vault collection contains too many records')
  }
  await measureVaultRecordBlobBytes(
    VAULT_RECORDS_DIR,
    recordIds,
    MAX_VAULT_COLLECTION_RECORDS,
    MAX_VAULT_COLLECTION_RECORD_BYTES,
  )
  await measureVaultAttachmentBlobBytes(
    VAULT_ATTACHMENTS_DIR,
    attachmentReferences,
    {
      maxCount: MAX_VAULT_COLLECTION_ATTACHMENTS,
      maxAggregateBytes: MAX_VAULT_COLLECTION_ATTACHMENT_BYTES,
    },
  )
  return {
    collection,
    recordIds,
    attachmentReferences,
    vaultBlob: seal(Buffer.from(manifestJson, 'utf8'), vaultKey),
  }
}

async function prepareLegacyVaultCollection(
  loaded: LoadedVaultState,
  vaultKey: Buffer,
): Promise<PreparedVaultCollectionState> {
  if (!loaded.legacy) throw new Error('Vault is already stored as a collection')
  const legacyVaultId = vaultRootId(loaded.persistedVault)
  const migratedVault = migrateLegacyVaultMutationReceipts(loaded.persistedVault, legacyVaultId)
  const preparedVault = migratedVault === loaded.persistedVault && loaded.legacyRecordManifest
    ? {
        manifest: loaded.legacyRecordManifest,
        recordIds: loaded.recordIds,
        attachmentReferences: loaded.attachmentReferences,
      }
    : await prepareVaultState(migratedVault, vaultKey, loaded.recordIds)
  return prepareVaultCollectionState(
    createVaultCollectionManifest({
      id: legacyVaultId,
      manifest: preparedVault.manifest,
      now: new Date().toISOString(),
    }),
    new Set(preparedVault.recordIds),
    new Map(preparedVault.attachmentReferences),
    vaultKey,
  )
}

async function prepareUpdatedActiveVault(
  current: LoadedVaultState,
  nextVault: Record<string, unknown>,
  vaultKey: Buffer,
): Promise<PreparedVaultCollectionState> {
  const activeVaultId = current.collection?.activeVaultId ?? vaultRootId(current.persistedVault)
  if (vaultRootId(nextVault) !== activeVaultId) {
    throw new Error('Vault root id cannot change during an update')
  }
  const preparedVault = await prepareVaultState(nextVault, vaultKey, current.recordIds)
  const now = new Date().toISOString()
  const collection = current.collection
    ? validateVaultCollectionManifest({
        ...current.collection,
        revision: current.collection.revision + 1,
        vaults: current.collection.vaults.map(entry => entry.id === activeVaultId
          ? { ...entry, updatedAt: now, manifest: preparedVault.manifest }
          : entry),
      })
    : createVaultCollectionManifest({
        id: activeVaultId,
        manifest: preparedVault.manifest,
        now,
      })
  const recordIds = new Set(preparedVault.recordIds)
  const attachmentReferences = new Map(preparedVault.attachmentReferences)
  for (const [id, decoded] of current.vaultsById) {
    if (id === activeVaultId) continue
    for (const recordId of decoded.recordIds) recordIds.add(recordId)
    for (const [referenceId, reference] of decoded.attachmentReferences) {
      attachmentReferences.set(referenceId, reference)
    }
  }
  return prepareVaultCollectionState(collection, recordIds, attachmentReferences, vaultKey)
}

function vaultRootId(vault: Record<string, unknown>): string {
  const root = vault.root
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('Vault root is unavailable')
  return validateExactVaultId((root as Record<string, unknown>).id)
}

function requireActiveVaultId(loaded: LoadedVaultState, expectedVaultId: string | undefined): void {
  if (expectedVaultId === undefined) return
  const vaultId = validateExactVaultId(expectedVaultId)
  const activeVaultId = loaded.collection?.activeVaultId ?? vaultRootId(loaded.persistedVault)
  if (activeVaultId !== vaultId) throw new Error('Vault selection changed')
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

  if (isVaultCollectionManifest(parsed)) {
    const collection = validateVaultCollectionManifest(parsed)
    const vaultsById = new Map<string, DecodedVaultEntry>()
    const recordIds = new Set<string>()
    const attachmentReferences = new Map<string, VaultAttachmentReference>()
    for (const entry of collection.vaults) {
      const decoded = await decodeVaultCollectionEntry(entry.manifest, vaultKey, options)
      if (vaultRootId(decoded.persistedVault) !== entry.id) {
        throw new Error('Vault collection entry id does not match its vault root')
      }
      for (const id of decoded.recordIds) recordIds.add(id)
      for (const [id, reference] of decoded.attachmentReferences) attachmentReferences.set(id, reference)
      vaultsById.set(entry.id, decoded)
    }
    validateBackupReferences(recordIds, attachmentReferences, vaultKey, options)
    const active = vaultsById.get(collection.activeVaultId)
    if (!active) throw new Error('Vault collection active vault is unavailable')
    const vault = options.hydrate === false
      ? active.persistedVault
      : await hydratePersistedVault(active.persistedVault, vaultKey)
    vaultsById.set(collection.activeVaultId, { ...active, vault })
    return {
      vault,
      persistedVault: active.persistedVault,
      recordIds,
      attachmentReferences,
      vaultBlob: Buffer.from(blob),
      legacy: false,
      collection,
      vaultsById,
      legacyRecordManifest: null,
    }
  }

  const recordManifest = isVaultRecordManifest(parsed)
    ? validateVaultRecordManifest(parsed)
    : null
  let persistedVault: Record<string, unknown>
  let recordIds = new Set<string>()
  if (recordManifest) {
    const decoded = await decodeVaultCollectionEntry(recordManifest, vaultKey, options)
    persistedVault = decoded.persistedVault
    recordIds = decoded.recordIds
  } else {
    if (options.backup && (options.recordBlobs?.size || options.attachmentBlobs?.size)) {
      throw new Error('Legacy backup contains unexpected content-addressed blobs')
    }
    const upgraded = upgradeAuthenticatedLegacyVault(parsed)
    validateVaultRoot(upgraded, { boundary: 'persisted' })
    persistedVault = upgraded
  }

  const attachmentReferences = collectVaultAttachmentRefs(persistedVault)
  validateBackupReferences(recordIds, attachmentReferences, vaultKey, options)
  const vault = options.hydrate === false
    ? persistedVault
    : await hydratePersistedVault(persistedVault, vaultKey)
  const id = vaultRootId(persistedVault)
  return {
    vault,
    persistedVault,
    recordIds,
    attachmentReferences,
    vaultBlob: Buffer.from(blob),
    legacy: true,
    collection: null,
    vaultsById: new Map([[id, { vault, persistedVault, recordIds, attachmentReferences }]]),
    legacyRecordManifest: recordManifest,
  }
}

async function decodeVaultCollectionEntry(
  manifest: VaultRecordManifest,
  vaultKey: Buffer,
  options: {
    recordBlobs?: ReadonlyMap<string, Buffer>
    backup?: boolean
  },
): Promise<DecodedVaultEntry> {
  const decoded = options.recordBlobs
    ? await decodeVaultRecordStoreFromBlobs(manifest, vaultKey, options.recordBlobs)
    : options.backup
      ? (() => { throw new Error('Backup is missing its vault record map') })()
      : await decodeVaultRecordStore(manifest, vaultKey, VAULT_RECORDS_DIR)
  return {
    vault: decoded.vault,
    persistedVault: decoded.vault,
    recordIds: decoded.recordIds,
    attachmentReferences: collectVaultAttachmentRefs(decoded.vault),
  }
}

function validateBackupReferences(
  recordIds: ReadonlySet<string>,
  attachmentReferences: ReadonlyMap<string, VaultAttachmentReference>,
  vaultKey: Buffer,
  options: {
    recordBlobs?: ReadonlyMap<string, Buffer>
    attachmentBlobs?: ReadonlyMap<string, Buffer>
    backup?: boolean
  },
): void {
  if (options.recordBlobs && recordIds.size !== options.recordBlobs.size) {
    throw new Error('Backup contains unreferenced vault records')
  }
  if (options.attachmentBlobs) {
    verifyVaultAttachmentBackupBlobMap(
      vaultKey,
      attachmentReferences.values(),
      options.attachmentBlobs,
      {
        maxCount: MAX_VAULT_COLLECTION_ATTACHMENTS,
        maxAggregateEncryptedBytes: MAX_VAULT_COLLECTION_ATTACHMENT_BYTES,
      },
    )
  } else if (options.backup && attachmentReferences.size > 0) {
    throw new Error('Backup is missing its attachment blob map')
  }
}

async function hydratePersistedVault(
  persistedVault: Record<string, unknown>,
  vaultKey: Buffer,
): Promise<Record<string, unknown>> {
  const vault = await hydrateVaultImageAttachments(
    persistedVault,
    reference => attachmentStore().read(vaultKey, reference),
  ) as Record<string, unknown>
  validateVaultRoot(vault, { boundary: 'persisted' })
  return vault
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

  if (vault?.version === '1' || vault?.version === '2') {
    vault.version = Number(vault.version)
  }

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
  if (snapshot.format === BACKUP_FORMAT || snapshot.format === PRIOR_BACKUP_FORMAT) {
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

async function garbageCollectAuthStateFiles(active: {
  vaultFile: string
  credentialsFile: string
  recoveryFile?: string
}): Promise<void> {
  // A completed manifest rename is the durability boundary. Old credential
  // and recovery wrappers are no longer needed after it and would otherwise
  // undermine password rotation or recovery-kit revocation on the active
  // installation. Cleanup remains best-effort so a deletion failure cannot
  // turn a committed rotation into a caller-visible failure.
  try {
    const entries = await fs.readdir(VAULT_DIR, { withFileTypes: true })
    const keep = new Set([
      active.vaultFile,
      active.credentialsFile,
      ...(active.recoveryFile ? [active.recoveryFile] : []),
    ])
    await Promise.allSettled(entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .filter(name => (
        /^credentials\.[A-Za-z0-9-]{1,80}\.json$/u.test(name)
        || /^recovery\.[A-Za-z0-9-]{1,80}\.json$/u.test(name)
      ) && !keep.has(name))
      .map(name => fs.rm(join(VAULT_DIR, name), { force: true })))
  } catch {
    // Best-effort cleanup after the manifest has already committed.
  }
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
  return new VaultAttachmentStore(VAULT_ATTACHMENTS_DIR, {
    maxCount: MAX_VAULT_COLLECTION_ATTACHMENTS,
    maxAggregateEncryptedBytes: MAX_VAULT_COLLECTION_ATTACHMENT_BYTES,
  })
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

type BackupBlobMapLimits = {
  readonly extension: string
  readonly maxCount: number
  readonly maxBlobBytes: number
  readonly maxAggregateBytes: number
  readonly label: string
}

async function readBackupBlobMap(
  directory: string,
  hashesValue: unknown,
  limits: BackupBlobMapLimits,
): Promise<Map<string, Buffer>> {
  const { extension, maxCount, maxBlobBytes, maxAggregateBytes, label } = limits
  if (!hashesValue || typeof hashesValue !== 'object' || Array.isArray(hashesValue)) {
    throw new Error(`Backup ${label} map is invalid`)
  }
  const hashes = Object.entries(hashesValue as Record<string, unknown>)
  if (hashes.length > maxCount) throw new Error(`Backup contains too many ${label} blobs`)
  const blobs = new Map<string, Buffer>()
  let aggregateBytes = 0
  for (const [id, expectedHash] of hashes) {
    validateContentId(id, label)
    if (typeof expectedHash !== 'string' || !CONTENT_ID_RE.test(expectedHash)) {
      throw new Error(`Backup ${label} hash is invalid`)
    }
    const blob = await readRegularFile(join(directory, `${id}${extension}`), maxBlobBytes)
    aggregateBytes += blob.byteLength
    if (aggregateBytes > maxAggregateBytes) throw new Error(`Backup ${label} blobs are too large`)
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
  return { manifest: null, vaultPath: VAULT_FILE, paramsRaw, wrappedKey, recoveryEnvelope: null }
}

async function resolveManifestState(manifest: AuthStateManifest): Promise<ActiveAuthState> {
  const credentialsPath = safeStatePath(manifest.credentialsFile)
  const vaultPath = safeStatePath(manifest.vaultFile)
  const [credentialsRaw, , recoveryRaw] = await Promise.all([
    readRegularFile(credentialsPath, MAX_BACKUP_METADATA_BYTES).then(value => value.toString('utf8')),
    fs.access(vaultPath),
    manifest.recoveryFile
      ? readRegularFile(safeStatePath(manifest.recoveryFile), MAX_BACKUP_METADATA_BYTES)
        .then(value => value.toString('utf8'))
      : Promise.resolve(null),
  ])
  const credentials = parseCredentials(credentialsRaw)
  return {
    manifest,
    vaultPath,
    paramsRaw: credentials.paramsRaw,
    wrappedKey: credentials.wrappedKey,
    recoveryEnvelope: recoveryRaw ? parseRecoveryEnvelope(JSON.parse(recoveryRaw)) : null,
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
  if (parsed.format !== STATE_FORMAT && parsed.format !== LEGACY_STATE_FORMAT) {
    throw new Error('Invalid auth-state manifest format')
  }
  const generation = safeGeneration(parsed.generation)
  const vaultFile = safeStateFilename(parsed.vaultFile, 'vault')
  const credentialsFile = safeStateFilename(parsed.credentialsFile, 'credentials')
  const recoveryFile = parsed.recoveryFile === undefined
    ? undefined
    : safeStateFilename(parsed.recoveryFile, 'recovery')
  if (parsed.format === LEGACY_STATE_FORMAT && recoveryFile) {
    throw new Error('Legacy auth-state manifest cannot reference recovery data')
  }
  return {
    format: parsed.format,
    generation,
    vaultFile,
    credentialsFile,
    ...(recoveryFile ? { recoveryFile } : {}),
  }
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
