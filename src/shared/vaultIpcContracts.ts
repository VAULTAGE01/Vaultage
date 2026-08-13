import type { VaultExportFormat, VaultExportScope } from './vaultExport'
import {
  assertCertificateMetadata,
  CertificateMetadataValidationError,
  type CertificateFormat,
  type CertificateMetadata,
} from './certificateMetadata'
import {
  SUPPORTED_PROVIDER_TYPES,
  SUPPORTED_SECRET_TYPES,
  VAULT_VALIDATION_LIMITS,
} from './vaultValidation'
import {
  contract,
  optionalString,
  requireRecord,
  requireString,
  validateNoPayload,
  type BaseIpcResult,
  type NoPayload,
} from './ipcContracts'

export type VaultNoPayload = NoPayload
export const VAULT_MUTATION_TYPES = [
  'bootstrap.defaults',
  'folder.create',
  'folder.rename',
  'folder.delete',
  'folder.duplicate',
  'folder.move-item',
  'folder.sort',
  'folder.import',
  'secret.create-many',
  'secret.create-many-and-map',
  'secret.update',
  'secret.provider-link.set',
  'secret.delete',
  'provider.create',
  'provider.update',
  'provider.update-with-secret',
  'provider.delete',
  'provider-group.create',
  'provider-group.rename',
  'provider-group.delete',
  'provider.move',
  'env-project.create',
  'env-project.update',
  'env-project.update-many',
  'env-project.delete',
  'preferences.patch',
] as const
export type VaultMutationType = typeof VAULT_MUTATION_TYPES[number]
export type VaultMutationCommand = { type: VaultMutationType; [key: string]: unknown }
export type VaultMutationPayload = {
  mutationId: string
  expectedRevision: number
  command: VaultMutationCommand
}
export type VaultSecretIdPayload = { secretId: string }
export type VaultSecretFieldPayload = { secretId: string; fieldKey: string; fieldId?: string }
export type VaultCopySecretFieldPayload = VaultSecretFieldPayload & {
  confirmationPhrase?: string
  pin?: string
}
export type VaultCopySecretImageFieldPayload = VaultSecretFieldPayload & {
  confirmationPhrase?: string
}
export type VaultSaveSecretImageFieldPayload = VaultSecretFieldPayload & { plaintextConfirmation?: string }
export type VaultPreviewCertificateMetadataPayload = {
  format: CertificateFormat
  certificateBase64: string
}
export type VaultRevealSecretFieldPayload = VaultSecretFieldPayload & {
  confirmationPhrase?: string
  pin?: string
}
export type VaultRevealSecretFieldsPayload = VaultSecretIdPayload & {
  confirmationPhrase?: string
  pin?: string
}
export type VaultSetRevealPinPayload = { pin: string; masterPassword: string }
export type VaultClearRevealPinPayload = { masterPassword: string }
export type VaultExportJsonPayload = { plaintextConfirmation?: string }
export type VaultExportScopePayload = {
  scope: VaultExportScope
  format: VaultExportFormat
  plaintextConfirmation?: string
  encryptionPassword?: string
}
export type VaultBeginEncryptedImportPayload = { data: string; password: string }
export type VaultCommitEncryptedImportPayload = {
  token: string
  selectionIds: string[]
  destinationFolderId: string
  expectedRevision: number
}
export type VaultCancelEncryptedImportPayload = { token: string }
export type VaultRestoreBackupPayload = {
  currentPassword: string
  backupPassword: string
  confirmation: string
}
export type VaultRestoreBackupWithKitPayload = {
  recoveryCode: string
  newPassword: string
  confirmation: string
}

export interface VaultCollectionInfo {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

export interface VaultCollectionSnapshot {
  revision: number
  activeVaultId: string
  vaults: VaultCollectionInfo[]
}

export type VaultCollectionResult = VaultBaseResult & {
  collection?: VaultCollectionSnapshot
  data?: unknown
  stale?: boolean
  alreadyCommitted?: boolean
}

export type VaultCollectionMutationPayload = {
  operationId: string
  expectedRevision: number
}
export type VaultCollectionCreatePayload = VaultCollectionMutationPayload & { name: string }
export type VaultCollectionIdPayload = VaultCollectionMutationPayload & { vaultId: string }
export type VaultCollectionRenamePayload = VaultCollectionIdPayload & { name: string }
export type VaultCollectionArchivePayload = VaultCollectionIdPayload & { archived: boolean }
export type VaultCollectionDeletePayload = VaultCollectionIdPayload & {
  confirmation: string
  masterPassword: string
}

export type VaultBaseResult = BaseIpcResult
export type VaultRevisionResult = VaultBaseResult & { revision?: number }
export type VaultMutationResult = VaultRevisionResult & {
  data?: unknown
  stale?: boolean
  result?: unknown
}
export type VaultRevealSecretFieldResult = VaultRevisionResult & {
  value?: string
  cancelled?: boolean
  notFound?: boolean
  authFailed?: boolean
}
export type VaultRevealSecretFieldsResult = VaultRevisionResult & {
  fields?: { key: string; value: string; sensitive: boolean }[]
  cancelled?: boolean
  notFound?: boolean
  authFailed?: boolean
}
export type VaultRevealPinResult = VaultMutationResult & { wrongPassword?: boolean }
export type VaultBackupResult = VaultBaseResult & { cancelled?: boolean; path?: string }
export type VaultRestoreBackupResult = VaultBackupResult & {
  wrongPassword?: boolean
  restartRequired?: boolean
  sessionChanged?: boolean
}
export type VaultExportResult = VaultBackupResult & { committed?: boolean }
export type VaultPreviewCertificateMetadataResult = VaultBaseResult & {
  certificate?: CertificateMetadata
  code?: 'empty' | 'too_large' | 'unsupported_format' | 'multiple_certificates' | 'invalid_certificate'
}
export interface VaultEncryptedImportPreviewItem {
  selectionId: string
  name: string
  type: string
  folderPath: string
  hasValue: boolean
}
export type VaultBeginEncryptedImportResult = VaultBaseResult & {
  token?: string
  revision?: number
  items?: VaultEncryptedImportPreviewItem[]
  expiresAt?: string
}
export type VaultCommitEncryptedImportResult = VaultMutationResult & {
  folderId?: string
  firstSecretId?: string | null
  secretCount?: number
  sessionExpired?: boolean
  stale?: boolean
}
export type VaultChangedEvent = {
  revision: number
  data: unknown
  source?: string
  vaultId?: string
}

export interface VaultIpcApi {
  listVaults(): Promise<VaultCollectionResult>
  createVault(payload: VaultCollectionCreatePayload): Promise<VaultCollectionResult>
  switchVault(payload: VaultCollectionIdPayload): Promise<VaultCollectionResult>
  renameVault(payload: VaultCollectionRenamePayload): Promise<VaultCollectionResult>
  setVaultArchived(payload: VaultCollectionArchivePayload): Promise<VaultCollectionResult>
  deleteVault(payload: VaultCollectionDeletePayload): Promise<VaultCollectionResult>
  mutate(payload: VaultMutationPayload): Promise<VaultMutationResult>
  trackUsage(payload: VaultSecretIdPayload): Promise<VaultRevisionResult>
  copySecretField(payload: VaultCopySecretFieldPayload): Promise<VaultRevisionResult>
  copySecretImageField(payload: VaultCopySecretImageFieldPayload): Promise<VaultRevisionResult>
  saveSecretImageField(payload: VaultSaveSecretImageFieldPayload): Promise<VaultExportResult>
  previewCertificateMetadata(
    payload: VaultPreviewCertificateMetadataPayload,
  ): Promise<VaultPreviewCertificateMetadataResult>
  revealSecretField(payload: VaultRevealSecretFieldPayload): Promise<VaultRevealSecretFieldResult>
  revealSecretImageField(payload: VaultRevealSecretFieldPayload): Promise<VaultRevealSecretFieldResult>
  revealSecretFields(payload: VaultRevealSecretFieldsPayload): Promise<VaultRevealSecretFieldsResult>
  setRevealPin(payload: VaultSetRevealPinPayload): Promise<VaultRevealPinResult>
  clearRevealPin(payload: VaultClearRevealPinPayload): Promise<VaultRevealPinResult>
  lock(): Promise<{ success: boolean }>
  signOut(): Promise<VaultBaseResult>
  backup(): Promise<VaultBackupResult>
  restoreBackup(payload: VaultRestoreBackupPayload): Promise<VaultRestoreBackupResult>
  restoreBackupWithKit(payload: VaultRestoreBackupWithKitPayload): Promise<VaultRestoreBackupResult & {
    data?: unknown
    recoveryKit?: import('./authIpcContracts').AuthRecoveryKitMaterial
    touchIdRestored?: boolean
    wrongRecoveryCode?: boolean
    retryAfterMs?: number
  }>
  exportJson(payload?: VaultExportJsonPayload): Promise<VaultExportResult>
  exportScope(payload: VaultExportScopePayload): Promise<VaultExportResult>
  saveImportTemplate(): Promise<VaultExportResult>
  beginEncryptedImport(payload: VaultBeginEncryptedImportPayload): Promise<VaultBeginEncryptedImportResult>
  commitEncryptedImport(payload: VaultCommitEncryptedImportPayload): Promise<VaultCommitEncryptedImportResult>
  cancelEncryptedImport(payload: VaultCancelEncryptedImportPayload): Promise<VaultBaseResult>
}

export const vaultIpcContracts = {
  listVaults: contract<VaultNoPayload, VaultCollectionResult>('vault:list-vaults', validateNoPayload),
  createVault: contract<VaultCollectionCreatePayload, VaultCollectionResult>(
    'vault:create-vault',
    validateVaultCollectionCreatePayload,
  ),
  switchVault: contract<VaultCollectionIdPayload, VaultCollectionResult>(
    'vault:switch-vault',
    validateVaultCollectionIdPayload,
  ),
  renameVault: contract<VaultCollectionRenamePayload, VaultCollectionResult>(
    'vault:rename-vault',
    validateVaultCollectionRenamePayload,
  ),
  setVaultArchived: contract<VaultCollectionArchivePayload, VaultCollectionResult>(
    'vault:set-vault-archived',
    validateVaultCollectionArchivePayload,
  ),
  deleteVault: contract<VaultCollectionDeletePayload, VaultCollectionResult>(
    'vault:delete-vault',
    validateVaultCollectionDeletePayload,
  ),
  mutate: contract<VaultMutationPayload, VaultMutationResult>('vault:mutate', validateVaultMutationPayload),
  trackUsage: contract<VaultSecretIdPayload, VaultRevisionResult>('vault:track-usage', validateSecretIdPayload),
  copySecretField: contract<VaultCopySecretFieldPayload, VaultRevisionResult>(
    'vault:copy-secret-field',
    validateCopySecretFieldPayload,
  ),
  copySecretImageField: contract<VaultCopySecretImageFieldPayload, VaultRevisionResult>(
    'vault:copy-secret-image-field',
    validateCopySecretImageFieldPayload,
  ),
  saveSecretImageField: contract<VaultSaveSecretImageFieldPayload, VaultExportResult>(
    'vault:save-secret-image-field',
    validateSaveSecretImageFieldPayload,
  ),
  previewCertificateMetadata: contract<
    VaultPreviewCertificateMetadataPayload,
    VaultPreviewCertificateMetadataResult
  >('vault:preview-certificate-metadata', validatePreviewCertificateMetadataPayload),
  revealSecretField: contract<VaultRevealSecretFieldPayload, VaultRevealSecretFieldResult>(
    'vault:reveal-secret-field',
    validateRevealSecretFieldPayload,
  ),
  revealSecretImageField: contract<VaultRevealSecretFieldPayload, VaultRevealSecretFieldResult>(
    'vault:reveal-secret-image-field',
    validateRevealSecretFieldPayload,
  ),
  revealSecretFields: contract<VaultRevealSecretFieldsPayload, VaultRevealSecretFieldsResult>(
    'vault:reveal-secret-fields',
    validateRevealSecretFieldsPayload,
  ),
  setRevealPin: contract<VaultSetRevealPinPayload, VaultRevealPinResult>(
    'vault:set-reveal-pin',
    validateSetRevealPinPayload,
  ),
  clearRevealPin: contract<VaultClearRevealPinPayload, VaultRevealPinResult>(
    'vault:clear-reveal-pin',
    validateClearRevealPinPayload,
  ),
  lock: contract<VaultNoPayload, { success: boolean }>('vault:lock', validateNoPayload),
  signOut: contract<VaultNoPayload, VaultBaseResult>('vault:sign-out', validateNoPayload),
  backup: contract<VaultNoPayload, VaultBackupResult>('vault:backup', validateNoPayload),
  restoreBackup: contract<VaultRestoreBackupPayload, VaultRestoreBackupResult>(
    'vault:restore-backup',
    validateRestoreBackupPayload,
  ),
  restoreBackupWithKit: contract<VaultRestoreBackupWithKitPayload, VaultRestoreBackupResult>(
    'vault:restore-backup-with-kit',
    validateRestoreBackupWithKitPayload,
  ),
  exportJson: contract<VaultExportJsonPayload, VaultExportResult>('vault:export-json', validateExportJsonPayload),
  exportScope: contract<VaultExportScopePayload, VaultExportResult>('vault:export-scope', validateExportScopePayload),
  saveImportTemplate: contract<VaultNoPayload, VaultExportResult>('vault:save-import-template', validateNoPayload),
  beginEncryptedImport: contract<VaultBeginEncryptedImportPayload, VaultBeginEncryptedImportResult>(
    'vault:begin-encrypted-import',
    validateBeginEncryptedImportPayload,
  ),
  commitEncryptedImport: contract<VaultCommitEncryptedImportPayload, VaultCommitEncryptedImportResult>(
    'vault:commit-encrypted-import',
    validateCommitEncryptedImportPayload,
  ),
  cancelEncryptedImport: contract<VaultCancelEncryptedImportPayload, VaultBaseResult>(
    'vault:cancel-encrypted-import',
    validateCancelEncryptedImportPayload,
  ),
} as const

export const vaultIpcEvents = {
  autoLock: 'vault:auto-lock',
  changed: 'vault:changed',
} as const

function validateVaultCollectionCreatePayload(payload: unknown): VaultCollectionCreatePayload {
  const record = requireRecord(payload, 'vault creation payload')
  requireExactKeys(record, ['operationId', 'expectedRevision', 'name'], [], 'vault creation payload')
  return { ...collectionMutationPayload(record), name: boundedVaultName(record.name) }
}

function validateVaultCollectionIdPayload(payload: unknown): VaultCollectionIdPayload {
  const record = requireRecord(payload, 'vault selection payload')
  requireExactKeys(record, ['operationId', 'expectedRevision', 'vaultId'], [], 'vault selection payload')
  return { ...collectionMutationPayload(record), vaultId: boundedId(record.vaultId, 'vault id') }
}

function validateVaultCollectionRenamePayload(payload: unknown): VaultCollectionRenamePayload {
  const record = requireRecord(payload, 'vault rename payload')
  requireExactKeys(record, ['operationId', 'expectedRevision', 'vaultId', 'name'], [], 'vault rename payload')
  return {
    ...collectionMutationPayload(record),
    vaultId: boundedId(record.vaultId, 'vault id'),
    name: boundedVaultName(record.name),
  }
}

function validateVaultCollectionArchivePayload(payload: unknown): VaultCollectionArchivePayload {
  const record = requireRecord(payload, 'vault archive payload')
  requireExactKeys(record, ['operationId', 'expectedRevision', 'vaultId', 'archived'], [], 'vault archive payload')
  if (typeof record.archived !== 'boolean') throw new Error('vault archive state must be a boolean')
  return {
    ...collectionMutationPayload(record),
    vaultId: boundedId(record.vaultId, 'vault id'),
    archived: record.archived,
  }
}

function validateVaultCollectionDeletePayload(payload: unknown): VaultCollectionDeletePayload {
  const record = requireRecord(payload, 'vault deletion payload')
  requireExactKeys(record, ['operationId', 'expectedRevision', 'vaultId', 'confirmation', 'masterPassword'], [], 'vault deletion payload')
  return {
    ...collectionMutationPayload(record),
    vaultId: boundedId(record.vaultId, 'vault id'),
    confirmation: boundedText(record.confirmation, 'vault deletion confirmation', 512),
    masterPassword: boundedText(record.masterPassword, 'master password', 1_024),
  }
}

function collectionMutationPayload(record: Record<string, unknown>): VaultCollectionMutationPayload {
  const operationId = boundedId(record.operationId, 'vault collection operation id')
  const expectedRevision = record.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('vault collection revision must be a positive integer')
  }
  return { operationId, expectedRevision }
}

function boundedVaultName(value: unknown): string {
  const name = boundedText(value, 'vault name', VAULT_VALIDATION_LIMITS.maxNameChars)
  if (name.trim() !== name || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('Invalid vault name')
  return name
}

function validateVaultMutationPayload(payload: unknown): VaultMutationPayload {
  const record = requireRecord(payload, 'vault mutation payload')
  requireExactKeys(record, ['mutationId', 'expectedRevision', 'command'], [], 'vault mutation payload')
  const mutationId = boundedId(record.mutationId, 'vault mutation id')
  const expectedRevision = record.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('vault mutation revision must be a positive integer')
  }
  const command = requireRecord(record.command, 'vault mutation command')
  const type = requireString(command.type, 'vault mutation type')
  if (!(VAULT_MUTATION_TYPES as readonly string[]).includes(type)) {
    throw new Error('Unsupported vault mutation type')
  }

  let encoded: Uint8Array
  try {
    encoded = new TextEncoder().encode(JSON.stringify(record))
  } catch {
    throw new Error('vault mutation payload must be serializable')
  }
  if (encoded.byteLength > 9 * 1024 * 1024) {
    throw new Error('vault mutation payload is too large')
  }

  validateBoundedJson(record)
  validateVaultMutationCommand(command, type as VaultMutationType)

  return {
    mutationId,
    expectedRevision,
    command: { ...command, type: type as VaultMutationType },
  }
}

const MUTATION_PAYLOAD_MAX_BYTES = 9 * 1024 * 1024
const MUTATION_JSON_MAX_DEPTH = VAULT_VALIDATION_LIMITS.maxFolderDepth + 8
// A valid 100k-entry environment mapping can contain roughly half a million
// primitive/object nodes while still fitting under the byte cap.
const MUTATION_JSON_MAX_NODES = 1_000_000
const SECRET_TYPES = new Set<string>(SUPPORTED_SECRET_TYPES)
const PROVIDER_TYPES = new Set<string>(SUPPORTED_PROVIDER_TYPES)

/**
 * Validate each semantic command before it reaches mutation code. The
 * canonical persisted-vault validator remains the final authority; this layer
 * rejects ambiguous command shapes and puts cheap bounds around attacker-
 * controlled traversal first.
 */
function validateVaultMutationCommand(command: Record<string, unknown>, type: VaultMutationType): void {
  switch (type) {
    case 'bootstrap.defaults': {
      requireExactKeys(command, ['type', 'folders'], [], type)
      const folders = boundedArray(command.folders, 'default folders', 64)
      folders.forEach((folder, index) => validateFolderStub(folder, `default folders[${index}]`))
      return
    }
    case 'folder.create':
      requireExactKeys(command, ['type', 'parentId', 'folder'], [], type)
      boundedId(command.parentId, 'parent folder id')
      validateFolderStub(command.folder, 'folder')
      return
    case 'folder.rename':
      requireExactKeys(command, ['type', 'folderId', 'name'], [], type)
      boundedId(command.folderId, 'folder id')
      boundedText(command.name, 'folder name', VAULT_VALIDATION_LIMITS.maxNameChars)
      return
    case 'folder.delete':
    case 'folder.duplicate':
      requireExactKeys(command, ['type', 'folderId'], [], type)
      boundedId(command.folderId, 'folder id')
      return
    case 'folder.move-item': {
      requireExactKeys(command, ['type', 'item', 'target'], [], type)
      validateTreeRef(command.item, 'tree item')
      const target = requireRecord(command.target, 'tree move target')
      requireExactKeys(target, ['folderId', 'position'], ['target'], 'tree move target')
      boundedId(target.folderId, 'target folder id')
      const position = boundedEnum(target.position, ['inside', 'before', 'after'], 'tree move position')
      if (position === 'inside') {
        if (target.target !== undefined) throw new Error('tree move target must not include a relative target for inside moves')
      } else {
        if (target.target === undefined) throw new Error('tree move target is required for relative moves')
        validateTreeRef(target.target, 'target tree item')
      }
      return
    }
    case 'folder.sort':
      requireExactKeys(command, ['type', 'folderId', 'key', 'direction'], [], type)
      boundedId(command.folderId, 'folder id')
      boundedEnum(command.key, ['title', 'createdAt', 'updatedAt', 'usageCount', 'lastUsedAt'], 'sort key')
      boundedEnum(command.direction, ['asc', 'desc'], 'sort direction')
      return
    case 'folder.import': {
      requireExactKeys(command, ['type', 'parentId', 'folder'], ['selectedSecretIds'], type)
      boundedId(command.parentId, 'parent folder id')
      validateFolderTree(command.folder, 'import folder')
      if (command.selectedSecretIds !== undefined) {
        const ids = boundedArray(command.selectedSecretIds, 'selected secret ids', VAULT_VALIDATION_LIMITS.maxSecrets)
        ids.forEach((value, index) => boundedId(value, `selected secret ids[${index}]`))
      }
      return
    }
    case 'secret.create-many': {
      requireExactKeys(command, ['type', 'folderId', 'secrets'], [], type)
      boundedId(command.folderId, 'folder id')
      validateSecretArray(command.secrets, 'secrets')
      return
    }
    case 'secret.create-many-and-map': {
      requireExactKeys(command, ['type', 'folderId', 'projectId', 'secrets', 'entries'], [], type)
      boundedId(command.folderId, 'folder id')
      boundedId(command.projectId, 'project id')
      validateSecretArray(command.secrets, 'secrets')
      validateEnvEntryArray(command.entries, 'environment entries')
      return
    }
    case 'secret.update':
      requireExactKeys(command, ['type', 'folderId', 'secret'], [], type)
      boundedId(command.folderId, 'folder id')
      validateSecret(command.secret, 'secret')
      return
    case 'secret.provider-link.set': {
      requireExactKeys(command, ['type', 'folderId', 'secretId', 'link'], [], type)
      boundedId(command.folderId, 'folder id')
      boundedId(command.secretId, 'secret id')
      if (command.link === null) return
      const link = requireRecord(command.link, 'provider link update')
      requireExactKeys(link, ['providerId', 'remoteName', 'status'], [], 'provider link update')
      boundedId(link.providerId, 'provider link provider id')
      boundedText(link.remoteName, 'provider link remote name', 1_024, true)
      boundedEnum(link.status, ['active', 'revoked', 'missing'], 'provider link status')
      return
    }
    case 'secret.delete':
      requireExactKeys(command, ['type', 'folderId', 'secretId'], [], type)
      boundedId(command.folderId, 'folder id')
      boundedId(command.secretId, 'secret id')
      return
    case 'provider.create':
      requireExactKeys(command, ['type', 'provider'], ['categoryId', 'categoryLabel', 'verificationGrant'], type)
      validateProvider(command.provider, 'provider')
      optionalBoundedText(command.categoryId, 'provider category id', 64)
      optionalBoundedText(command.categoryLabel, 'provider category label', VAULT_VALIDATION_LIMITS.maxNameChars)
      validateOptionalVerificationGrant(command.verificationGrant)
      return
    case 'provider.update':
      requireExactKeys(command, ['type', 'provider'], ['verificationGrant'], type)
      validateProvider(command.provider, 'provider')
      validateOptionalVerificationGrant(command.verificationGrant)
      return
    case 'provider.update-with-secret':
      requireExactKeys(command, ['type', 'provider', 'folderId', 'secret'], ['verificationGrant'], type)
      validateProvider(command.provider, 'provider')
      boundedId(command.folderId, 'folder id')
      validateSecret(command.secret, 'secret')
      validateOptionalVerificationGrant(command.verificationGrant)
      return
    case 'provider.delete':
      requireExactKeys(command, ['type', 'providerId'], [], type)
      boundedId(command.providerId, 'provider id')
      return
    case 'provider-group.create':
      requireExactKeys(command, ['type', 'group'], [], type)
      validateProviderGroup(command.group, 'provider group')
      return
    case 'provider-group.rename':
      requireExactKeys(command, ['type', 'groupId', 'name'], [], type)
      boundedId(command.groupId, 'provider group id')
      boundedText(command.name, 'provider group name', VAULT_VALIDATION_LIMITS.maxNameChars)
      return
    case 'provider-group.delete':
      requireExactKeys(command, ['type', 'groupId'], [], type)
      boundedId(command.groupId, 'provider group id')
      return
    case 'provider.move': {
      requireExactKeys(command, ['type', 'providerId', 'groupId'], ['targetProviderId', 'position'], type)
      boundedId(command.providerId, 'provider id')
      if (command.groupId !== null) optionalBoundedId(command.groupId, 'provider group id')
      const hasTarget = command.targetProviderId !== undefined
      const hasPosition = command.position !== undefined
      if (hasTarget !== hasPosition) throw new Error('provider move target and position must be supplied together')
      optionalBoundedId(command.targetProviderId, 'target provider id')
      if (hasPosition) boundedEnum(command.position, ['before', 'after'], 'provider move position')
      return
    }
    case 'env-project.create':
      requireExactKeys(command, ['type', 'project'], ['targetVerificationGrant'], type)
      validateEnvProject(command.project, 'environment project')
      validateOptionalVerificationGrant(command.targetVerificationGrant)
      return
    case 'env-project.update':
      requireExactKeys(command, ['type', 'project'], ['targetVerificationGrant'], type)
      validateEnvProject(command.project, 'environment project')
      validateOptionalVerificationGrant(command.targetVerificationGrant)
      return
    case 'env-project.update-many': {
      requireExactKeys(command, ['type', 'projects'], ['targetVerificationGrant'], type)
      const projects = boundedArray(command.projects, 'environment projects', VAULT_VALIDATION_LIMITS.maxProjects)
      projects.forEach((project, index) => validateEnvProject(project, `environment projects[${index}]`))
      validateOptionalVerificationGrant(command.targetVerificationGrant)
      return
    }
    case 'env-project.delete':
      requireExactKeys(command, ['type', 'projectId'], [], type)
      boundedId(command.projectId, 'environment project id')
      return
    case 'preferences.patch':
      requireExactKeys(command, ['type', 'patch'], [], type)
      validatePreferencesPatch(command.patch)
      return
  }
}

function validateFolderStub(value: unknown, label: string): void {
  const folder = requireRecord(value, label)
  requireExactKeys(folder, ['id', 'name'], ['children', 'secrets', 'itemOrder'], label)
  boundedId(folder.id, `${label} id`)
  boundedText(folder.name, `${label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
  for (const key of ['children', 'secrets', 'itemOrder'] as const) {
    if (folder[key] !== undefined && boundedArray(folder[key], `${label} ${key}`, 0).length !== 0) {
      throw new Error(`${label} ${key} must be empty`)
    }
  }
}

function validateFolderTree(value: unknown, label: string): void {
  const pending: Array<{ value: unknown; label: string; depth: number }> = [{ value, label, depth: 0 }]
  let folderCount = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.depth > VAULT_VALIDATION_LIMITS.maxFolderDepth) throw new Error(`${label} is too deeply nested`)
    const folder = requireRecord(current.value, current.label)
    requireExactKeys(folder, ['id', 'name'], ['children', 'secrets', 'itemOrder'], current.label)
    boundedId(folder.id, `${current.label} id`)
    boundedText(folder.name, `${current.label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
    folderCount += 1
    if (folderCount > VAULT_VALIDATION_LIMITS.maxFolders) throw new Error(`${label} contains too many folders`)
    const children = folder.children === undefined
      ? []
      : boundedArray(folder.children, `${current.label} children`, VAULT_VALIDATION_LIMITS.maxFolders)
    const secrets = folder.secrets === undefined
      ? []
      : boundedArray(folder.secrets, `${current.label} secrets`, VAULT_VALIDATION_LIMITS.maxSecrets)
    secrets.forEach((secret, index) => validateSecret(secret, `${current.label} secrets[${index}]`))
    if (folder.itemOrder !== undefined) {
      const order = boundedArray(folder.itemOrder, `${current.label} item order`, VAULT_VALIDATION_LIMITS.maxItemOrderEntries)
      order.forEach((item, index) => validateTreeRef(item, `${current.label} item order[${index}]`))
    }
    children.forEach((child, index) => pending.push({
      value: child,
      label: `${current.label} children[${index}]`,
      depth: current.depth + 1,
    }))
  }
}

function validateTreeRef(value: unknown, label: string): void {
  const ref = requireRecord(value, label)
  requireExactKeys(ref, ['kind', 'id'], [], label)
  boundedEnum(ref.kind, ['folder', 'secret'], `${label} kind`)
  boundedId(ref.id, `${label} id`)
}

function validateSecretArray(value: unknown, label: string): void {
  const secrets = boundedArray(value, label, VAULT_VALIDATION_LIMITS.maxSecrets)
  secrets.forEach((secret, index) => validateSecret(secret, `${label}[${index}]`))
}

function validateSecret(value: unknown, label: string): void {
  const secret = requireRecord(value, label)
  requireExactKeys(secret, ['id', 'name', 'type', 'fields', 'notes', 'createdAt', 'updatedAt'], [
    'description', 'scope', 'tags', 'expiresAt', 'usedIn', 'lastUsedAt', 'usageCount', 'providerLink', 'agentAvailable',
    'browserExtensionAllowed', 'revealAllowed', 'cliExportAllowed', 'certificate',
  ], label)
  boundedId(secret.id, `${label} id`)
  boundedText(secret.name, `${label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
  boundedEnum(secret.type, SECRET_TYPES, `${label} type`)
  const fields = boundedArray(secret.fields, `${label} fields`, VAULT_VALIDATION_LIMITS.maxFieldsPerSecret)
  fields.forEach((field, index) => validateSecretField(field, `${label} fields[${index}]`))
  boundedText(secret.notes, `${label} notes`, VAULT_VALIDATION_LIMITS.maxNotesChars, true)
  boundedText(secret.createdAt, `${label} created at`, 128)
  boundedText(secret.updatedAt, `${label} updated at`, 128)
  optionalBoundedText(secret.description, `${label} description`, 64 * 1024, true)
  optionalBoundedText(secret.scope, `${label} scope`, 256, true)
  optionalStringList(secret.tags, `${label} tags`, 1_000, 512)
  optionalBoundedText(secret.expiresAt, `${label} expiry`, 128)
  optionalStringList(secret.usedIn, `${label} usage locations`, 10_000, 4_096)
  optionalBoundedText(secret.lastUsedAt, `${label} last used at`, 128)
  if (secret.usageCount !== undefined) boundedInteger(secret.usageCount, `${label} usage count`, 0)
  if (secret.agentAvailable !== undefined) boundedBoolean(secret.agentAvailable, `${label} agent availability`)
  if (secret.browserExtensionAllowed !== undefined) boundedBoolean(secret.browserExtensionAllowed, `${label} browser extension availability`)
  if (secret.revealAllowed !== undefined) boundedBoolean(secret.revealAllowed, `${label} reveal availability`)
  if (secret.cliExportAllowed !== undefined) boundedBoolean(secret.cliExportAllowed, `${label} CLI export availability`)
  if (secret.providerLink !== undefined) validateProviderLink(secret.providerLink, `${label} provider link`)
  if (secret.type === 'certificate') {
    if (secret.certificate === undefined) throw new Error(`${label} certificate is required for certificate secrets`)
    validateCertificateMetadataBoundary(secret.certificate, `${label} certificate`)
  } else if (secret.certificate !== undefined) {
    throw new Error(`${label} certificate is supported only for certificate secrets`)
  }
}

function validateCertificateMetadataBoundary(value: unknown, label: string): void {
  try {
    assertCertificateMetadata(value)
  } catch (error) {
    if (error instanceof CertificateMetadataValidationError) {
      if (error.code === 'unsupported_property') {
        throw new Error(`${label} contains unsupported property ${error.field}`)
      }
      throw new Error(`Invalid ${label}${error.field ? ` ${error.field}` : ''}: ${error.requirement}`)
    }
    throw error
  }
}

function validateSecretField(value: unknown, label: string): void {
  const field = requireRecord(value, label)
  requireExactKeys(field, ['key', 'value', 'sensitive'], ['id'], label)
  optionalBoundedId(field.id, `${label} id`)
  boundedText(field.key, `${label} key`, VAULT_VALIDATION_LIMITS.maxFieldKeyChars)
  boundedText(field.value, `${label} value`, MUTATION_PAYLOAD_MAX_BYTES, true)
  boundedBoolean(field.sensitive, `${label} sensitivity`)
}

function validateProviderLink(value: unknown, label: string): void {
  const link = requireRecord(value, label)
  requireExactKeys(link, ['providerId', 'remoteName', 'createdInVaultage'], [
    'scopes', 'remoteId', 'lastVerifiedAt', 'status', 'statusUpdatedAt',
  ], label)
  boundedId(link.providerId, `${label} provider id`)
  boundedText(link.remoteName, `${label} remote name`, 1_024, true)
  boundedBoolean(link.createdInVaultage, `${label} ownership`)
  optionalStringList(link.scopes, `${label} scopes`, 1_000, 1_024)
  optionalBoundedText(link.remoteId, `${label} remote id`, 1_024, true)
  optionalBoundedText(link.lastVerifiedAt, `${label} last verified at`, 128)
  if (link.status !== undefined) boundedEnum(link.status, ['active', 'revoked', 'missing'], `${label} status`)
  optionalBoundedText(link.statusUpdatedAt, `${label} status updated at`, 128)
}

function validateProvider(value: unknown, label: string): void {
  const provider = requireRecord(value, label)
  requireExactKeys(provider, ['id', 'name', 'type', 'config'], [
    'lastSyncAt', 'connectionStatus', 'lastTestedAt', 'groupId',
  ], label)
  boundedId(provider.id, `${label} id`)
  boundedText(provider.name, `${label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
  boundedEnum(provider.type, PROVIDER_TYPES, `${label} type`)
  const config = requireRecord(provider.config, `${label} config`)
  const configEntries = Object.entries(config)
  if (configEntries.length > VAULT_VALIDATION_LIMITS.maxProviderConfigEntries) {
    throw new Error(`${label} config contains too many fields`)
  }
  for (const [key, configValue] of configEntries) {
    boundedText(key, `${label} config key`, VAULT_VALIDATION_LIMITS.maxFieldKeyChars)
    boundedText(configValue, `${label} config.${key}`, VAULT_VALIDATION_LIMITS.maxFieldValueChars, true)
  }
  optionalBoundedText(provider.lastSyncAt, `${label} last sync at`, 128)
  if (provider.connectionStatus !== undefined) {
    boundedEnum(provider.connectionStatus, ['configured', 'verified', 'error'], `${label} connection status`)
  }
  optionalBoundedText(provider.lastTestedAt, `${label} last tested at`, 128)
  if (provider.groupId !== null) optionalBoundedId(provider.groupId, `${label} group id`)
}

function validateOptionalVerificationGrant(value: unknown): void {
  const grant = optionalBoundedText(value, 'provider verification grant', 512)
  if (grant !== undefined && grant.length < 32) {
    throw new Error('provider verification grant is too short')
  }
}

function validateProviderGroup(value: unknown, label: string): void {
  const group = requireRecord(value, label)
  requireExactKeys(group, ['id', 'name'], ['categoryId'], label)
  boundedId(group.id, `${label} id`)
  boundedText(group.name, `${label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
  optionalBoundedText(group.categoryId, `${label} category id`, 64)
}

function validateEnvProject(value: unknown, label: string): void {
  const project = requireRecord(value, label)
  requireExactKeys(project, ['id', 'name', 'path', 'entries', 'addToGitignore'], [
    'manualScanFiles', 'lastExportAt', 'environments',
  ], label)
  const projectId = boundedId(project.id, `${label} id`)
  boundedText(project.name, `${label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
  boundedText(project.path, `${label} path`, 32_768, true)
  validateEnvEntryArray(project.entries, `${label} entries`)
  boundedBoolean(project.addToGitignore, `${label} add-to-gitignore flag`)
  optionalStringList(project.manualScanFiles, `${label} manual scan files`, 1_000, 32_768)
  optionalBoundedText(project.lastExportAt, `${label} last export at`, 128)
  if (project.environments !== undefined) {
    const environments = boundedArray(
      project.environments,
      `${label} environments`,
      VAULT_VALIDATION_LIMITS.maxEnvironmentsPerProject,
    )
    environments.forEach((environment, index) => validateEnvironment(
      environment,
      `${label} environments[${index}]`,
      projectId,
    ))
  }
}

function validateEnvironment(value: unknown, label: string, projectId: string): void {
  const environment = requireRecord(value, label)
  requireExactKeys(environment, ['id', 'name', 'scope', 'kind', 'entries'], [
    'path', 'providerId', 'providerEnvName', 'syncRule', 'addToGitignore', 'manualScanFiles', 'lastSyncAt', 'providerBinding',
  ], label)
  const environmentId = boundedId(environment.id, `${label} id`)
  boundedText(environment.name, `${label} name`, VAULT_VALIDATION_LIMITS.maxNameChars)
  const scope = boundedText(environment.scope, `${label} scope`, 256, true)
  boundedEnum(environment.kind, ['local', 'cloud'], `${label} kind`)
  validateEnvEntryArray(environment.entries, `${label} entries`)
  optionalBoundedText(environment.path, `${label} path`, 32_768, true)
  optionalBoundedId(environment.providerId, `${label} provider id`)
  optionalBoundedText(environment.providerEnvName, `${label} provider environment name`, 1_024, true)
  if (environment.syncRule !== undefined) boundedEnum(environment.syncRule, ['manual', 'push', 'pull'], `${label} sync rule`)
  if (environment.providerBinding !== undefined) {
    if (environment.kind !== 'cloud') throw new Error(`${label} provider binding requires a cloud environment`)
    if (environment.providerId === undefined) throw new Error(`${label} provider binding requires a provider`)
    if (environment.syncRule !== undefined && environment.syncRule !== 'manual') {
      throw new Error(`${label} provider binding requires manual sync`)
    }
    if (!isFixedProviderEnvironment(projectId, environmentId, scope)) {
      throw new Error(`${label} provider binding must use the fixed project environment id and scope`)
    }
    requireRecord(environment.providerBinding, `${label} provider binding`)
  }
  if (environment.addToGitignore !== undefined) boundedBoolean(environment.addToGitignore, `${label} add-to-gitignore flag`)
  optionalStringList(environment.manualScanFiles, `${label} manual scan files`, 1_000, 32_768)
  optionalBoundedText(environment.lastSyncAt, `${label} last sync at`, 128)
}

function isFixedProviderEnvironment(projectId: string, environmentId: string, scope: string): boolean {
  return ['development', 'staging', 'production'].includes(scope)
    && environmentId === `${projectId}:${scope}`
}

function validateEnvEntryArray(value: unknown, label: string): void {
  const entries = boundedArray(value, label, VAULT_VALIDATION_LIMITS.maxEnvEntries)
  entries.forEach((value, index) => {
    const entryLabel = `${label}[${index}]`
    const entry = requireRecord(value, entryLabel)
    requireExactKeys(entry, ['secretId', 'fieldKey', 'envKey'], ['fieldId'], entryLabel)
    boundedId(entry.secretId, `${entryLabel} secret id`)
    optionalBoundedId(entry.fieldId, `${entryLabel} field id`)
    boundedText(entry.fieldKey, `${entryLabel} field key`, VAULT_VALIDATION_LIMITS.maxFieldKeyChars)
    boundedText(entry.envKey, `${entryLabel} environment key`, 512)
  })
}

function validatePreferencesPatch(value: unknown): void {
  const patch = requireRecord(value, 'preferences patch')
  requireExactKeys(patch, [], [
    'localDefaultFoldersCreated', 'defaultAgentAvailable', 'agentApiPort', 'onboardingResearchSurvey',
    'providerVotes', 'localDashboardPinnedOrder', 'localDashboardOnboardingDismissed', 'accountCreated',
  ], 'preferences patch')
  for (const key of [
    'localDefaultFoldersCreated', 'defaultAgentAvailable', 'localDashboardOnboardingDismissed', 'accountCreated',
  ] as const) {
    if (patch[key] !== undefined) boundedBoolean(patch[key], `preferences patch ${key}`)
  }
  if (patch.agentApiPort !== undefined) boundedInteger(patch.agentApiPort, 'preferences patch agent API port', 1, 65_535)
  if (patch.localDashboardPinnedOrder !== undefined) {
    optionalStringList(
      patch.localDashboardPinnedOrder,
      'preferences patch pinned order',
      VAULT_VALIDATION_LIMITS.maxPinnedItems,
      VAULT_VALIDATION_LIMITS.maxIdChars + 16,
    )
  }
  if (patch.onboardingResearchSurvey !== undefined) {
    const survey = requireRecord(patch.onboardingResearchSurvey, 'preferences survey')
    requireExactKeys(survey, ['status', 'promptedAt'], ['respondedAt', 'reminderAt'], 'preferences survey')
    boundedEnum(survey.status, ['opened', 'skipped', 'remind_later', 'completed'], 'preferences survey status')
    boundedText(survey.promptedAt, 'preferences survey prompted at', 128)
    optionalBoundedText(survey.respondedAt, 'preferences survey responded at', 128)
    optionalBoundedText(survey.reminderAt, 'preferences survey reminder at', 128)
  }
  if (patch.providerVotes !== undefined) {
    const votes = requireRecord(patch.providerVotes, 'preferences provider votes')
    if (Object.keys(votes).length > VAULT_VALIDATION_LIMITS.maxProviders) {
      throw new Error('preferences provider votes contains too many entries')
    }
    for (const [key, rawVote] of Object.entries(votes)) {
      boundedText(key, 'preferences provider vote key', VAULT_VALIDATION_LIMITS.maxIdChars)
      const vote = requireRecord(rawVote, `preferences provider vote ${key}`)
      requireExactKeys(vote, ['providerId', 'providerName', 'votedAt'], ['source'], `preferences provider vote ${key}`)
      boundedId(vote.providerId, `preferences provider vote ${key} provider id`)
      boundedText(vote.providerName, `preferences provider vote ${key} provider name`, VAULT_VALIDATION_LIMITS.maxNameChars)
      boundedText(vote.votedAt, `preferences provider vote ${key} voted at`, 128)
      optionalBoundedText(vote.source, `preferences provider vote ${key} source`, 1_024, true)
    }
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported property ${key}`)
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      throw new Error(`${label} is missing required property ${key}`)
    }
  }
}

function boundedArray(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > max) throw new Error(`${label} contains too many items`)
  return value
}

function boundedId(value: unknown, label: string): string {
  const result = boundedText(value, label, VAULT_VALIDATION_LIMITS.maxIdChars)
  if (!result.trim() || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`Invalid ${label}`)
  return result
}

function optionalBoundedId(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : boundedId(value, label)
}

function boundedText(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (!allowEmpty && value.length === 0) throw new Error(`${label} must not be empty`)
  if (value.length > max) throw new Error(`${label} is too long`)
  return value
}

function optionalBoundedText(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): string | undefined {
  return value === undefined || value === null ? undefined : boundedText(value, label, max, allowEmpty)
}

function boundedBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function boundedInteger(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`)
  }
  return value as number
}

function boundedEnum<T extends string>(
  value: unknown,
  values: readonly T[] | ReadonlySet<string>,
  label: string,
): T {
  const valid = typeof value === 'string' && (
    Array.isArray(values) ? (values as readonly string[]).includes(value) : (values as ReadonlySet<string>).has(value)
  )
  if (!valid) throw new Error(`Invalid ${label}`)
  return value as T
}

function optionalStringList(value: unknown, label: string, maxItems: number, maxChars: number): void {
  if (value === undefined || value === null) return
  const items = boundedArray(value, label, maxItems)
  items.forEach((item, index) => boundedText(item, `${label}[${index}]`, maxChars, true))
}

// Kept separate from domain limits so a future command cannot accidentally
// introduce an unbounded generic object traversal at the IPC boundary.
function validateBoundedJson(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > MUTATION_JSON_MAX_NODES) throw new Error('vault mutation payload is too complex')
    if (current.depth > MUTATION_JSON_MAX_DEPTH) throw new Error('vault mutation payload is too deeply nested')
    // Optional structured-clone properties commonly arrive as explicit
    // `undefined`; command-specific validators decide whether each is allowed.
    if (
      current.value === null
      || current.value === undefined
      || ['string', 'boolean', 'number'].includes(typeof current.value)
    ) continue
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 })
      continue
    }
    if (current.value && typeof current.value === 'object') {
      for (const item of Object.values(current.value as Record<string, unknown>)) {
        pending.push({ value: item, depth: current.depth + 1 })
      }
      continue
    }
    throw new Error('vault mutation payload contains an unsupported value')
  }
}

function validateRestoreBackupPayload(payload: unknown): VaultRestoreBackupPayload {
  const record = requireRecord(payload, 'restore backup payload')
  const confirmation = requireString(record.confirmation, 'restore confirmation')
  if (confirmation !== 'RESTORE VAULT') throw new Error('Type RESTORE VAULT to confirm backup restore')
  return {
    currentPassword: requireString(record.currentPassword, 'current password'),
    backupPassword: requireString(record.backupPassword, 'backup password'),
    confirmation,
  }
}

function validateRestoreBackupWithKitPayload(payload: unknown): VaultRestoreBackupWithKitPayload {
  const record = requireRecord(payload, 'Emergency Kit backup restore payload')
  const confirmation = requireString(record.confirmation, 'restore confirmation')
  if (confirmation !== 'RESTORE VAULT') throw new Error('Type RESTORE VAULT to confirm backup restore')
  return {
    recoveryCode: requireString(record.recoveryCode, 'recovery code'),
    newPassword: requireString(record.newPassword, 'new password'),
    confirmation,
  }
}

function validateSecretIdPayload(payload: unknown): VaultSecretIdPayload {
  const record = requireRecord(payload, 'secret payload')
  return { secretId: requireString(record.secretId, 'secret id') }
}

function validateCopySecretFieldPayload(payload: unknown): VaultCopySecretFieldPayload {
  const record = requireRecord(payload, 'copy secret field payload')
  requireExactKeys(
    record,
    ['secretId', 'fieldKey'],
    ['fieldId', 'confirmationPhrase', 'pin'],
    'copy secret field payload',
  )
  return {
    secretId: requireString(record.secretId, 'secret id'),
    fieldKey: requireString(record.fieldKey, 'field key'),
    fieldId: optionalBoundedId(record.fieldId, 'secret field id'),
    confirmationPhrase: optionalString(record.confirmationPhrase, 'confirmation phrase'),
    pin: optionalString(record.pin, 'reveal PIN'),
  }
}

function validateCopySecretImageFieldPayload(payload: unknown): VaultCopySecretImageFieldPayload {
  const record = requireRecord(payload, 'copy secret image field payload')
  requireExactKeys(
    record,
    ['secretId', 'fieldKey'],
    ['fieldId', 'confirmationPhrase'],
    'copy secret image field payload',
  )
  return {
    secretId: requireString(record.secretId, 'secret id'),
    fieldKey: requireString(record.fieldKey, 'secret field key'),
    fieldId: optionalBoundedId(record.fieldId, 'secret field id'),
    confirmationPhrase: optionalString(record.confirmationPhrase, 'confirmation phrase'),
  }
}

function validateSaveSecretImageFieldPayload(payload: unknown): VaultSaveSecretImageFieldPayload {
  const record = requireRecord(payload, 'save secret image field payload')
  requireExactKeys(
    record,
    ['secretId', 'fieldKey'],
    ['fieldId', 'plaintextConfirmation'],
    'save secret image field payload',
  )
  return {
    secretId: requireString(record.secretId, 'secret id'),
    fieldKey: requireString(record.fieldKey, 'field key'),
    fieldId: optionalBoundedId(record.fieldId, 'secret field id'),
    plaintextConfirmation: optionalString(record.plaintextConfirmation, 'confirmation phrase'),
  }
}

const MAX_CERTIFICATE_IMPORT_BASE64_CHARS = 1_333_336
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

function validatePreviewCertificateMetadataPayload(payload: unknown): VaultPreviewCertificateMetadataPayload {
  const record = requireRecord(payload, 'certificate metadata preview payload')
  requireExactKeys(record, ['format', 'certificateBase64'], [], 'certificate metadata preview payload')
  const format = record.format
  if (format !== 'PEM' && format !== 'DER' && format !== 'PKCS12') {
    throw new Error('certificate format must be PEM, DER, or PKCS12')
  }
  const certificateBase64 = requireString(record.certificateBase64, 'certificate data')
  if (certificateBase64.length > MAX_CERTIFICATE_IMPORT_BASE64_CHARS) {
    throw new Error('certificate data is too large')
  }
  if (!BASE64_RE.test(certificateBase64)) throw new Error('certificate data must use base64 encoding')
  return { format, certificateBase64 }
}

function validateRevealSecretFieldPayload(payload: unknown): VaultRevealSecretFieldPayload {
  const record = requireRecord(payload, 'reveal secret field payload')
  return {
    secretId: requireString(record.secretId, 'secret id'),
    fieldKey: requireString(record.fieldKey, 'field key'),
    fieldId: optionalBoundedId(record.fieldId, 'secret field id'),
    confirmationPhrase: optionalString(record.confirmationPhrase, 'confirmation phrase'),
    pin: optionalString(record.pin, 'PIN'),
  }
}

function validateRevealSecretFieldsPayload(payload: unknown): VaultRevealSecretFieldsPayload {
  const record = requireRecord(payload, 'reveal secret payload')
  return {
    secretId: requireString(record.secretId, 'secret id'),
    confirmationPhrase: optionalString(record.confirmationPhrase, 'confirmation phrase'),
    pin: optionalString(record.pin, 'PIN'),
  }
}

function validateSetRevealPinPayload(payload: unknown): VaultSetRevealPinPayload {
  const record = requireRecord(payload, 'set reveal PIN payload')
  return {
    pin: requireString(record.pin, 'PIN'),
    masterPassword: requireString(record.masterPassword, 'master password'),
  }
}

function validateClearRevealPinPayload(payload: unknown): VaultClearRevealPinPayload {
  const record = requireRecord(payload, 'clear reveal PIN payload')
  return { masterPassword: requireString(record.masterPassword, 'master password') }
}

function validateExportJsonPayload(payload: unknown): VaultExportJsonPayload {
  if (payload === undefined || payload === null) return {}
  const record = requireRecord(payload, 'export payload')
  return { plaintextConfirmation: optionalString(record.plaintextConfirmation, 'plaintext confirmation') }
}

function validateExportScopePayload(payload: unknown): VaultExportScopePayload {
  const record = requireRecord(payload, 'export scope payload')
  return {
    scope: validateExportScope(record.scope),
    format: validateExportFormat(record.format),
    plaintextConfirmation: optionalString(record.plaintextConfirmation, 'plaintext confirmation'),
    encryptionPassword: optionalString(record.encryptionPassword, 'encryption password'),
  }
}

function validateBeginEncryptedImportPayload(payload: unknown): VaultBeginEncryptedImportPayload {
  const record = requireRecord(payload, 'decrypt export payload')
  requireExactKeys(record, ['data', 'password'], [], 'decrypt export payload')
  return {
    data: requireString(record.data, 'encrypted export data'),
    password: requireString(record.password, 'export password'),
  }
}

function validateCommitEncryptedImportPayload(payload: unknown): VaultCommitEncryptedImportPayload {
  const record = requireRecord(payload, 'commit encrypted import payload')
  requireExactKeys(
    record,
    ['token', 'selectionIds', 'destinationFolderId', 'expectedRevision'],
    [],
    'commit encrypted import payload',
  )
  const selectionIds = boundedArray(
    record.selectionIds,
    'encrypted import selection ids',
    VAULT_VALIDATION_LIMITS.maxSecrets,
  ).map((value, index) => boundedId(value, `encrypted import selection ids[${index}]`))
  if (selectionIds.length === 0) throw new Error('Select at least one secret to import')
  if (new Set(selectionIds).size !== selectionIds.length) {
    throw new Error('Encrypted import selection ids must be unique')
  }
  const expectedRevision = record.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('encrypted import revision must be a positive integer')
  }
  return {
    token: boundedId(record.token, 'encrypted import token'),
    selectionIds,
    destinationFolderId: boundedId(record.destinationFolderId, 'encrypted import destination folder id'),
    expectedRevision,
  }
}

function validateCancelEncryptedImportPayload(payload: unknown): VaultCancelEncryptedImportPayload {
  const record = requireRecord(payload, 'cancel encrypted import payload')
  requireExactKeys(record, ['token'], [], 'cancel encrypted import payload')
  return { token: boundedId(record.token, 'encrypted import token') }
}

function validateExportFormat(format: unknown): VaultExportFormat {
  if (format === 'json' || format === 'csv' || format === 'encrypted') return format
  throw new Error('Invalid export format')
}

function validateExportScope(scope: unknown): VaultExportScope {
  const record = requireRecord(scope, 'export scope')
  if (record.kind === 'vault') return { kind: 'vault' }
  if (record.kind === 'folder') return { kind: 'folder', id: validateExportId(record.id, 'folder id') }
  if (record.kind === 'secret') return { kind: 'secret', id: validateExportId(record.id, 'secret id') }
  throw new Error('Invalid export scope')
}

function validateExportId(value: unknown, label: string): string {
  const id = requireString(value, `export ${label}`)
  if (!id || id.length > 240 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error(`Invalid export ${label}`)
  }
  return id
}
