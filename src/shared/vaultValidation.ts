import {
  REDACTED_PROVIDER_CONFIG_VALUE,
  REDACTED_SECRET_VALUE,
} from './vaultRedaction'

export const SUPPORTED_VAULT_VERSIONS = [1, 2] as const
export const CURRENT_VAULT_VERSION = 2

export const SUPPORTED_SECRET_TYPES = [
  'password',
  'apiKey',
  'sshKey',
  'secureNote',
  'custom',
  'image',
] as const
export type SupportedSecretType = typeof SUPPORTED_SECRET_TYPES[number]

export const SUPPORTED_PROVIDER_TYPES = [
  'doppler',
  'vercel',
  'cloudflare',
  'gitlab',
  'github',
  'aws',
  'gcp',
  'azure',
  'openai',
  'supabase',
  'firebase',
  'netlify',
  'twilio',
  'resend',
  'custom',
] as const
export type SupportedProviderType = typeof SUPPORTED_PROVIDER_TYPES[number]

export const VAULT_VALIDATION_LIMITS = Object.freeze({
  maxJsonBytes: 10 * 1024 * 1024,
  maxFolderDepth: 32,
  maxFolders: 10_000,
  maxSecrets: 50_000,
  maxFieldsPerSecret: 256,
  maxFields: 250_000,
  maxProviders: 1_000,
  maxProviderGroups: 1_000,
  maxProjects: 10_000,
  maxEnvironmentsPerProject: 256,
  maxEnvEntries: 100_000,
  maxItemOrderEntries: 100_000,
  maxPinnedItems: 10_000,
  maxIdChars: 240,
  maxNameChars: 512,
  maxFieldKeyChars: 256,
  maxFieldValueChars: 2 * 1024 * 1024,
  maxNotesChars: 2 * 1024 * 1024,
  maxProviderConfigEntries: 256,
  // Base64 expands data by roughly 4/3. These limits leave space under the
  // 10 MiB encrypted-document plaintext cap for structure and non-image data.
  maxEmbeddedImageBytes: 7 * 1024 * 1024,
  maxEmbeddedImageBytesAggregate: 7 * 1024 * 1024,
})

export type VaultValidationBoundary = 'persisted' | 'renderer' | 'import'

export interface VaultValidationOptions {
  /**
   * Renderer snapshots may contain explicit redaction sentinels. Those values
   * are accepted structurally at this boundary and must be merged with the
   * persisted vault before a persisted validation is performed.
   */
  boundary?: VaultValidationBoundary
}

export interface VaultExportEnvelope {
  format: 'vaultage.export.v1'
  vault: Record<string, unknown>
}

export class VaultValidationError extends Error {
  readonly name = 'VaultValidationError'

  constructor(
    readonly path: string,
    readonly code: string,
    requirement: string,
  ) {
    // Never interpolate a rejected value here. Vault values can contain
    // plaintext secrets and errors are displayed/logged by multiple callers.
    super(`Invalid vault at ${path}: ${requirement}`)
  }
}

interface PendingReference {
  path: string
  id: string
}

interface PendingEnvEntry extends PendingReference {
  fieldKey: string
  fieldId?: string
}

interface SecretFieldCatalog {
  keys: Set<string>
  byId: Map<string, string>
}

interface FolderContents {
  folders: Set<string>
  secrets: Set<string>
}

interface ValidationState {
  boundary: VaultValidationBoundary
  folders: Set<string>
  secrets: Map<string, SecretFieldCatalog>
  providers: Set<string>
  providerGroups: Set<string>
  projects: Set<string>
  environmentIds: Set<string>
  folderContents: Map<string, FolderContents>
  providerLinks: PendingReference[]
  providerGroupsUsed: PendingReference[]
  envEntries: PendingEnvEntry[]
  environmentProviders: PendingReference[]
  pins: { path: string; kind: 'secret' | 'project' | 'service'; id: string }[]
  folderCount: number
  secretCount: number
  fieldCount: number
  envEntryCount: number
  itemOrderCount: number
  embeddedImageBytes: number
}

const SECRET_TYPES = new Set<string>(SUPPORTED_SECRET_TYPES)
const PROVIDER_TYPES = new Set<string>(SUPPORTED_PROVIDER_TYPES)
const PROVIDER_LINK_STATUSES = new Set(['active', 'revoked', 'missing'])
const ENVIRONMENT_KINDS = new Set(['local', 'cloud'])
const SYNC_RULES = new Set(['manual', 'push', 'pull'])
const CATEGORY_IDS = new Set([
  'build',
  'ai',
  'code',
  'backend',
  'deploy',
  'secure',
  'connect',
  'observe',
  'monetize',
])
const SURVEY_STATUSES = new Set(['opened', 'skipped', 'remind_later', 'completed'])
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const IMAGE_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/= \t\r\n]+)$/i
const IMAGE_ATTACHMENT_REF_RE = /^vaultage-attachment:v1:[0-9a-f]{64}:image\/[a-z0-9][a-z0-9.+-]{0,63}$/
const HEX_RE = /^[0-9a-f]+$/i

/**
 * Validates the complete decrypted VaultRoot without returning or copying any
 * plaintext. Unknown properties are intentionally preserved for compatible
 * migrations, while every known field and relationship is checked.
 */
export function validateVaultRoot(
  value: unknown,
  options: VaultValidationOptions = {},
): asserts value is Record<string, unknown> {
  const root = record(value, '$')
  const boundary = options.boundary ?? 'persisted'
  const state: ValidationState = {
    boundary,
    folders: new Set(),
    secrets: new Map(),
    providers: new Set(),
    providerGroups: new Set(),
    projects: new Set(),
    environmentIds: new Set(),
    folderContents: new Map(),
    providerLinks: [],
    providerGroupsUsed: [],
    envEntries: [],
    environmentProviders: [],
    pins: [],
    folderCount: 0,
    secretCount: 0,
    fieldCount: 0,
    envEntryCount: 0,
    itemOrderCount: 0,
    embeddedImageBytes: 0,
  }

  const version = integer(root.version, '$.version', { min: 1 })
  if (!(SUPPORTED_VAULT_VERSIONS as readonly number[]).includes(version)) {
    fail('$.version', 'unsupported_version', 'uses an unsupported vault format version')
  }
  optionalInteger(root.revision, '$.revision', { min: 1 })

  const providers = optionalArray(root.providers, '$.providers', VAULT_VALIDATION_LIMITS.maxProviders)
  for (let index = 0; index < providers.length; index += 1) {
    validateProvider(providers[index], `$.providers[${index}]`, state)
  }

  const groups = optionalArray(
    root.providerGroups,
    '$.providerGroups',
    VAULT_VALIDATION_LIMITS.maxProviderGroups,
  )
  for (let index = 0; index < groups.length; index += 1) {
    validateProviderGroup(groups[index], `$.providerGroups[${index}]`, state)
  }

  validateFolderTree(root.root, '$.root', state)

  const projects = optionalArray(root.envProjects, '$.envProjects', VAULT_VALIDATION_LIMITS.maxProjects)
  for (let index = 0; index < projects.length; index += 1) {
    validateProject(projects[index], `$.envProjects[${index}]`, state)
  }

  if (root.preferences !== undefined) {
    validatePreferences(root.preferences, '$.preferences', state)
  }

  validateReferences(state)
}

/** Validate either a raw VaultRoot or the documented scoped-export envelope. */
export function validateVaultImportPayload(
  value: unknown,
  options: VaultValidationOptions = { boundary: 'import' },
): Record<string, unknown> {
  const candidate = unwrapVaultExportEnvelope(value)
  validateVaultRoot(candidate, options)
  return candidate
}

export function unwrapVaultExportEnvelope(value: unknown): unknown {
  if (!isRecord(value) || value.format !== 'vaultage.export.v1') return value
  if (value.vault === undefined) {
    fail('$.vault', 'required', 'is required for a Vaultage export')
  }
  if (value.exportedAt !== undefined) isoDateTime(value.exportedAt, '$.exportedAt')
  if (value.itemCount !== undefined) integer(value.itemCount, '$.itemCount', { min: 0 })
  return value.vault
}

function validateFolderTree(value: unknown, path: string, state: ValidationState): void {
  const pending: { value: unknown; path: string; depth: number }[] = [{ value, path, depth: 0 }]
  const visited = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.depth > VAULT_VALIDATION_LIMITS.maxFolderDepth) {
      fail(current.path, 'limit', 'exceeds the maximum folder depth')
    }
    const folder = record(current.value, current.path)
    if (visited.has(folder)) fail(current.path, 'cycle', 'contains a folder cycle')
    visited.add(folder)

    state.folderCount += 1
    if (state.folderCount > VAULT_VALIDATION_LIMITS.maxFolders) {
      fail(current.path, 'limit', 'contains too many folders')
    }
    const folderId = id(folder.id, `${current.path}.id`)
    addUnique(state.folders, folderId, `${current.path}.id`, 'folder')
    text(folder.name, `${current.path}.name`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })

    // Missing collections are accepted for pre-provider/pre-ordering vaults;
    // every current save normalises them back to arrays.
    const children = optionalArray(folder.children, `${current.path}.children`, VAULT_VALIDATION_LIMITS.maxFolders)
    const secrets = optionalArray(folder.secrets, `${current.path}.secrets`, VAULT_VALIDATION_LIMITS.maxSecrets)
    const directContents: FolderContents = { folders: new Set(), secrets: new Set() }
    state.folderContents.set(folderId, directContents)

    for (let index = 0; index < secrets.length; index += 1) {
      const secretPath = `${current.path}.secrets[${index}]`
      const secretId = validateSecret(secrets[index], secretPath, state)
      addUnique(directContents.secrets, secretId, `${secretPath}.id`, 'secret in folder')
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childPath = `${current.path}.children[${index}]`
      const child = record(children[index], childPath)
      const childId = id(child.id, `${childPath}.id`)
      addUnique(directContents.folders, childId, `${childPath}.id`, 'child folder')
      pending.push({ value: child, path: childPath, depth: current.depth + 1 })
    }

    if (folder.itemOrder !== undefined) {
      const order = array(folder.itemOrder, `${current.path}.itemOrder`, VAULT_VALIDATION_LIMITS.maxItemOrderEntries)
      state.itemOrderCount += order.length
      if (state.itemOrderCount > VAULT_VALIDATION_LIMITS.maxItemOrderEntries) {
        fail(`${current.path}.itemOrder`, 'limit', 'contains too many ordering entries')
      }
      const seen = new Set<string>()
      for (let index = 0; index < order.length; index += 1) {
        const itemPath = `${current.path}.itemOrder[${index}]`
        const item = record(order[index], itemPath)
        if (item.kind !== 'folder' && item.kind !== 'secret') {
          fail(`${itemPath}.kind`, 'enum', 'must be folder or secret')
        }
        const itemId = id(item.id, `${itemPath}.id`)
        const key = `${item.kind}:${itemId}`
        addUnique(seen, key, itemPath, 'item-order entry')
        const known = item.kind === 'folder' ? directContents.folders : directContents.secrets
        if (!known.has(itemId)) {
          fail(itemPath, 'dangling_reference', 'references an item outside its folder')
        }
      }
    }
  }
}

function validateSecret(value: unknown, path: string, state: ValidationState): string {
  const secret = record(value, path)
  state.secretCount += 1
  if (state.secretCount > VAULT_VALIDATION_LIMITS.maxSecrets) {
    fail(path, 'limit', 'contains too many secrets')
  }

  const secretId = id(secret.id, `${path}.id`)
  if (state.secrets.has(secretId)) {
    fail(`${path}.id`, 'duplicate_id', 'duplicates a secret identifier')
  }
  const fieldCatalog: SecretFieldCatalog = { keys: new Set(), byId: new Map() }
  state.secrets.set(secretId, fieldCatalog)
  text(secret.name, `${path}.name`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })
  const secretType = enumText(secret.type, `${path}.type`, SECRET_TYPES, 'uses an unsupported secret type')
  const fields = array(secret.fields, `${path}.fields`, VAULT_VALIDATION_LIMITS.maxFieldsPerSecret)
  const fieldKeys = fieldCatalog.keys
  state.fieldCount += fields.length
  if (state.fieldCount > VAULT_VALIDATION_LIMITS.maxFields) {
    fail(`${path}.fields`, 'limit', 'contains too many secret fields')
  }

  let imageFieldCount = 0
  for (let index = 0; index < fields.length; index += 1) {
    const fieldPath = `${path}.fields[${index}]`
    const field = record(fields[index], fieldPath)
    const fieldKey = text(field.key, `${fieldPath}.key`, {
      max: VAULT_VALIDATION_LIMITS.maxFieldKeyChars,
    })
    // Duplicate field labels are supported by the current redaction merge, so
    // this set is for reference lookup rather than uniqueness enforcement.
    fieldKeys.add(fieldKey)
    if (field.id !== undefined) {
      const fieldId = id(field.id, `${fieldPath}.id`)
      if (fieldCatalog.byId.has(fieldId)) {
        fail(`${fieldPath}.id`, 'duplicate_id', 'duplicates a secret field identifier')
      }
      fieldCatalog.byId.set(fieldId, fieldKey)
    }
    const fieldValue = text(field.value, `${fieldPath}.value`, {
      allowEmpty: true,
      max: secretType === 'image'
        ? Math.ceil(VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes * 4 / 3) + 256
        : VAULT_VALIDATION_LIMITS.maxFieldValueChars,
    })
    const sensitive = boolean(field.sensitive, `${fieldPath}.sensitive`)

    if (fieldValue === REDACTED_SECRET_VALUE && state.boundary !== 'renderer') {
      fail(`${fieldPath}.value`, 'redacted_value', 'contains an unresolved redacted value')
    }

    if (secretType === 'image' && fieldKey === '__image__') {
      imageFieldCount += 1
      if (!sensitive) fail(`${fieldPath}.sensitive`, 'image_shape', 'must be sensitive for embedded images')
      validateEmbeddedImage(fieldValue, `${fieldPath}.value`, state)
    }
  }
  if (secretType === 'image' && imageFieldCount !== 1) {
    fail(`${path}.fields`, 'image_shape', 'must contain exactly one __image__ field')
  }

  const notes = text(secret.notes, `${path}.notes`, {
    allowEmpty: true,
    max: VAULT_VALIDATION_LIMITS.maxNotesChars,
  })
  if (notes === REDACTED_SECRET_VALUE && state.boundary !== 'renderer') {
    fail(`${path}.notes`, 'redacted_value', 'contains an unresolved redacted value')
  }
  isoDateTime(secret.createdAt, `${path}.createdAt`)
  isoDateTime(secret.updatedAt, `${path}.updatedAt`)
  optionalText(secret.description, `${path}.description`, { allowEmpty: true, max: 64 * 1024 })
  optionalText(secret.scope, `${path}.scope`, { allowEmpty: true, max: 256 })
  optionalStringArray(secret.tags, `${path}.tags`, 1_000, 512)
  optionalDateOrDateTime(secret.expiresAt, `${path}.expiresAt`)
  optionalStringArray(secret.usedIn, `${path}.usedIn`, 10_000, 4_096)
  optionalIsoDateTime(secret.lastUsedAt, `${path}.lastUsedAt`)
  optionalInteger(secret.usageCount, `${path}.usageCount`, { min: 0 })
  optionalBoolean(secret.agentAvailable, `${path}.agentAvailable`)
  optionalBoolean(secret.browserExtensionAllowed, `${path}.browserExtensionAllowed`)
  optionalBoolean(secret.revealAllowed, `${path}.revealAllowed`)
  optionalBoolean(secret.cliExportAllowed, `${path}.cliExportAllowed`)

  if (secret.providerLink !== undefined) {
    const link = record(secret.providerLink, `${path}.providerLink`)
    const providerId = id(link.providerId, `${path}.providerLink.providerId`)
    state.providerLinks.push({ path: `${path}.providerLink.providerId`, id: providerId })
    text(link.remoteName, `${path}.providerLink.remoteName`, { allowEmpty: true, max: 1_024 })
    boolean(link.createdInVaultage, `${path}.providerLink.createdInVaultage`)
    optionalStringArray(link.scopes, `${path}.providerLink.scopes`, 1_000, 1_024)
    optionalText(link.remoteId, `${path}.providerLink.remoteId`, { allowEmpty: true, max: 1_024 })
    optionalIsoDateTime(link.lastVerifiedAt, `${path}.providerLink.lastVerifiedAt`)
    if (link.status !== undefined) {
      enumText(
        link.status,
        `${path}.providerLink.status`,
        PROVIDER_LINK_STATUSES,
        'uses an unsupported provider-link status',
      )
    }
    optionalIsoDateTime(link.statusUpdatedAt, `${path}.providerLink.statusUpdatedAt`)
  }

  return secretId
}

function validateProvider(value: unknown, path: string, state: ValidationState): void {
  const provider = record(value, path)
  const providerId = id(provider.id, `${path}.id`)
  addUnique(state.providers, providerId, `${path}.id`, 'provider')
  text(provider.name, `${path}.name`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })
  enumText(provider.type, `${path}.type`, PROVIDER_TYPES, 'uses an unsupported provider type')
  const config = record(provider.config, `${path}.config`)
  const configEntries = Object.entries(config)
  if (configEntries.length > VAULT_VALIDATION_LIMITS.maxProviderConfigEntries) {
    fail(`${path}.config`, 'limit', 'contains too many configuration fields')
  }
  for (const [key, value] of configEntries) {
    if (key.length === 0 || key.length > VAULT_VALIDATION_LIMITS.maxFieldKeyChars) {
      fail(`${path}.config`, 'shape', 'contains an invalid configuration key')
    }
    const configValue = text(value, `${path}.config.${safePathKey(key)}`, {
      allowEmpty: true,
      max: VAULT_VALIDATION_LIMITS.maxFieldValueChars,
    })
    if (state.boundary !== 'renderer' && configValue === REDACTED_PROVIDER_CONFIG_VALUE) {
      fail(`${path}.config.${safePathKey(key)}`, 'redacted_value', 'contains an unresolved redacted value')
    }
  }
  optionalIsoDateTime(provider.lastSyncAt, `${path}.lastSyncAt`)
  if (provider.connectionStatus !== undefined) {
    enumText(
      provider.connectionStatus,
      `${path}.connectionStatus`,
      new Set(['configured', 'verified', 'error']),
      'uses an unsupported connection status',
    )
  }
  optionalIsoDateTime(provider.lastTestedAt, `${path}.lastTestedAt`)
  if (provider.groupId !== undefined && provider.groupId !== null) {
    const groupId = id(provider.groupId, `${path}.groupId`)
    state.providerGroupsUsed.push({ path: `${path}.groupId`, id: groupId })
  }
}

function validateProviderGroup(value: unknown, path: string, state: ValidationState): void {
  const group = record(value, path)
  const groupId = id(group.id, `${path}.id`)
  addUnique(state.providerGroups, groupId, `${path}.id`, 'provider group')
  text(group.name, `${path}.name`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })
  if (group.categoryId !== undefined) {
    enumText(group.categoryId, `${path}.categoryId`, CATEGORY_IDS, 'uses an unsupported service category')
  }
}

function validateProject(value: unknown, path: string, state: ValidationState): void {
  const project = record(value, path)
  const projectId = id(project.id, `${path}.id`)
  addUnique(state.projects, projectId, `${path}.id`, 'environment project')
  text(project.name, `${path}.name`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })
  text(project.path, `${path}.path`, { allowEmpty: true, max: 32_768 })
  boolean(project.addToGitignore, `${path}.addToGitignore`)
  validateEnvEntries(project.entries, `${path}.entries`, state)
  optionalStringArray(project.manualScanFiles, `${path}.manualScanFiles`, 1_000, 32_768)
  optionalIsoDateTime(project.lastExportAt, `${path}.lastExportAt`)

  const environments = optionalArray(
    project.environments,
    `${path}.environments`,
    VAULT_VALIDATION_LIMITS.maxEnvironmentsPerProject,
  )
  const projectEnvironmentIds = new Set<string>()
  for (let index = 0; index < environments.length; index += 1) {
    const environmentPath = `${path}.environments[${index}]`
    const environment = record(environments[index], environmentPath)
    const environmentId = id(environment.id, `${environmentPath}.id`)
    addUnique(projectEnvironmentIds, environmentId, `${environmentPath}.id`, 'project environment')
    addUnique(state.environmentIds, environmentId, `${environmentPath}.id`, 'project environment')
    text(environment.name, `${environmentPath}.name`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })
    const fixedScope = text(environment.scope, `${environmentPath}.scope`, { allowEmpty: true, max: 256 })
    enumText(environment.kind, `${environmentPath}.kind`, ENVIRONMENT_KINDS, 'uses an unsupported environment kind')
    validateEnvEntries(environment.entries, `${environmentPath}.entries`, state)
    optionalText(environment.path, `${environmentPath}.path`, { allowEmpty: true, max: 32_768 })
    if (environment.providerId !== undefined) {
      const providerId = id(environment.providerId, `${environmentPath}.providerId`)
      state.environmentProviders.push({ path: `${environmentPath}.providerId`, id: providerId })
    }
    optionalText(environment.providerEnvName, `${environmentPath}.providerEnvName`, {
      allowEmpty: true,
      max: 1_024,
    })
    if (environment.syncRule !== undefined) {
      enumText(environment.syncRule, `${environmentPath}.syncRule`, SYNC_RULES, 'uses an unsupported sync rule')
    }
    if (environment.providerBinding !== undefined) {
      if (environment.kind !== 'cloud') {
        fail(`${environmentPath}.providerBinding`, 'relationship', 'requires a cloud environment')
      }
      if (environment.providerId === undefined) {
        fail(`${environmentPath}.providerBinding`, 'relationship', 'requires a provider')
      }
      if (environment.syncRule !== undefined && environment.syncRule !== 'manual') {
        fail(`${environmentPath}.syncRule`, 'unsupported', 'provider project actions require explicit manual approval')
      }
      if (!isFixedProviderEnvironment(projectId, environmentId, fixedScope)) {
        fail(`${environmentPath}.id`, 'relationship', 'must match the fixed provider environment scope')
      }
      record(environment.providerBinding, `${environmentPath}.providerBinding`)
    }
    optionalBoolean(environment.addToGitignore, `${environmentPath}.addToGitignore`)
    optionalStringArray(environment.manualScanFiles, `${environmentPath}.manualScanFiles`, 1_000, 32_768)
    optionalIsoDateTime(environment.lastSyncAt, `${environmentPath}.lastSyncAt`)
  }
}

function isFixedProviderEnvironment(projectId: string, environmentId: string, scope: string): boolean {
  return ['development', 'staging', 'production'].includes(scope)
    && environmentId === `${projectId}:${scope}`
}

function validateEnvEntries(value: unknown, path: string, state: ValidationState): void {
  const entries = array(value, path, VAULT_VALIDATION_LIMITS.maxEnvEntries)
  state.envEntryCount += entries.length
  if (state.envEntryCount > VAULT_VALIDATION_LIMITS.maxEnvEntries) {
    fail(path, 'limit', 'contains too many environment entries')
  }
  const envKeys = new Set<string>()
  for (let index = 0; index < entries.length; index += 1) {
    const entryPath = `${path}[${index}]`
    const entry = record(entries[index], entryPath)
    const secretId = id(entry.secretId, `${entryPath}.secretId`)
    const fieldId = entry.fieldId === undefined
      ? undefined
      : id(entry.fieldId, `${entryPath}.fieldId`)
    const fieldKey = text(entry.fieldKey, `${entryPath}.fieldKey`, {
      max: VAULT_VALIDATION_LIMITS.maxFieldKeyChars,
    })
    const envKey = text(entry.envKey, `${entryPath}.envKey`, { max: 512 })
    if (!ENV_KEY_RE.test(envKey)) {
      fail(`${entryPath}.envKey`, 'format', 'must be a portable environment-variable name')
    }
    addUnique(envKeys, envKey, `${entryPath}.envKey`, 'environment key')
    state.envEntries.push({ path: entryPath, id: secretId, fieldKey, fieldId })
  }
}

function validatePreferences(value: unknown, path: string, state: ValidationState): void {
  const preferences = record(value, path)
  optionalBoolean(preferences.localDefaultFoldersCreated, `${path}.localDefaultFoldersCreated`)
  optionalBoolean(preferences.defaultAgentAvailable, `${path}.defaultAgentAvailable`)
  optionalInteger(preferences.agentApiPort, `${path}.agentApiPort`, { min: 1, max: 65_535 })
  optionalBoolean(preferences.localDashboardOnboardingDismissed, `${path}.localDashboardOnboardingDismissed`)
  optionalBoolean(preferences.quickRevealPinEnabled, `${path}.quickRevealPinEnabled`)
  optionalBoolean(preferences.accountCreated, `${path}.accountCreated`)

  if (preferences.localDashboardPinnedOrder !== undefined) {
    const pins = array(
      preferences.localDashboardPinnedOrder,
      `${path}.localDashboardPinnedOrder`,
      VAULT_VALIDATION_LIMITS.maxPinnedItems,
    )
    const seen = new Set<string>()
    for (let index = 0; index < pins.length; index += 1) {
      const pinPath = `${path}.localDashboardPinnedOrder[${index}]`
      const pin = text(pins[index], pinPath, { max: VAULT_VALIDATION_LIMITS.maxIdChars + 16 })
      addUnique(seen, pin, pinPath, 'dashboard pin')
      const separator = pin.indexOf(':')
      if (separator < 0) {
        state.pins.push({ path: pinPath, kind: 'secret', id: pin })
        continue
      }
      const kind = pin.slice(0, separator)
      const targetId = pin.slice(separator + 1)
      if (kind !== 'secret' && kind !== 'project' && kind !== 'service') {
        fail(pinPath, 'format', 'uses an unsupported dashboard pin kind')
      }
      id(targetId, pinPath)
      state.pins.push({ path: pinPath, kind, id: targetId })
    }
  }

  if (preferences.activeEnvProjectIds !== undefined) {
    const activeIds = array(
      preferences.activeEnvProjectIds,
      `${path}.activeEnvProjectIds`,
      VAULT_VALIDATION_LIMITS.maxProjects,
    )
    const seen = new Set<string>()
    for (let index = 0; index < activeIds.length; index += 1) {
      const activePath = `${path}.activeEnvProjectIds[${index}]`
      addUnique(seen, id(activeIds[index], activePath), activePath, 'active environment project')
    }
  }

  if (preferences.onboardingResearchSurvey !== undefined) {
    const survey = record(preferences.onboardingResearchSurvey, `${path}.onboardingResearchSurvey`)
    enumText(survey.status, `${path}.onboardingResearchSurvey.status`, SURVEY_STATUSES, 'uses an unsupported survey status')
    isoDateTime(survey.promptedAt, `${path}.onboardingResearchSurvey.promptedAt`)
    optionalIsoDateTime(survey.respondedAt, `${path}.onboardingResearchSurvey.respondedAt`)
    optionalIsoDateTime(survey.reminderAt, `${path}.onboardingResearchSurvey.reminderAt`)
  }

  if (preferences.providerVotes !== undefined) {
    const votes = record(preferences.providerVotes, `${path}.providerVotes`)
    if (Object.keys(votes).length > VAULT_VALIDATION_LIMITS.maxProviders) {
      fail(`${path}.providerVotes`, 'limit', 'contains too many provider votes')
    }
    for (const [key, rawVote] of Object.entries(votes)) {
      const votePath = `${path}.providerVotes.${safePathKey(key)}`
      const vote = record(rawVote, votePath)
      text(vote.providerId, `${votePath}.providerId`, { max: VAULT_VALIDATION_LIMITS.maxIdChars })
      text(vote.providerName, `${votePath}.providerName`, { max: VAULT_VALIDATION_LIMITS.maxNameChars })
      isoDateTime(vote.votedAt, `${votePath}.votedAt`)
      optionalText(vote.source, `${votePath}.source`, { allowEmpty: true, max: 1_024 })
    }
  }

  if (preferences.quickRevealPin !== undefined) {
    if (state.boundary === 'renderer') {
      fail(`${path}.quickRevealPin`, 'secret_metadata', 'must not be supplied by the renderer')
    }
    const pin = record(preferences.quickRevealPin, `${path}.quickRevealPin`)
    const version = integer(pin.version, `${path}.quickRevealPin.version`, { min: 1 })
    if (version !== 1) fail(`${path}.quickRevealPin.version`, 'unsupported_version', 'uses an unsupported PIN format')
    const scrypt = record(pin.scrypt, `${path}.quickRevealPin.scrypt`)
    const scryptN = integer(scrypt.N, `${path}.quickRevealPin.scrypt.N`, { min: 2, max: 1 << 24 })
    if ((scryptN & (scryptN - 1)) !== 0) {
      fail(`${path}.quickRevealPin.scrypt.N`, 'format', 'must be a power of two')
    }
    integer(scrypt.r, `${path}.quickRevealPin.scrypt.r`, { min: 1, max: 1_024 })
    integer(scrypt.p, `${path}.quickRevealPin.scrypt.p`, { min: 1, max: 1_024 })
    integer(scrypt.keylen, `${path}.quickRevealPin.scrypt.keylen`, { min: 16, max: 64 })
    hexText(scrypt.salt, `${path}.quickRevealPin.scrypt.salt`, 16, 512)
    hexText(pin.verifier, `${path}.quickRevealPin.verifier`, 32, 1_024)
    isoDateTime(pin.updatedAt, `${path}.quickRevealPin.updatedAt`)
  }
}

function validateReferences(state: ValidationState): void {
  for (const reference of state.providerLinks) {
    if (!state.providers.has(reference.id)) {
      fail(reference.path, 'dangling_reference', 'references a missing provider')
    }
  }
  for (const reference of state.providerGroupsUsed) {
    if (!state.providerGroups.has(reference.id)) {
      fail(reference.path, 'dangling_reference', 'references a missing provider group')
    }
  }
  for (const reference of state.environmentProviders) {
    if (!state.providers.has(reference.id)) {
      fail(reference.path, 'dangling_reference', 'references a missing provider')
    }
  }
  for (const entry of state.envEntries) {
    const fields = state.secrets.get(entry.id)
    if (!fields) {
      fail(`${entry.path}.secretId`, 'dangling_reference', 'references a missing secret')
    }
    if (entry.fieldId !== undefined) {
      const currentKey = fields.byId.get(entry.fieldId)
      if (currentKey === undefined) {
        fail(`${entry.path}.fieldId`, 'dangling_reference', 'references a missing secret field')
      }
      if (currentKey !== entry.fieldKey) {
        fail(`${entry.path}.fieldKey`, 'stale_reference', 'does not match the referenced secret field')
      }
    } else if (!fields.keys.has(entry.fieldKey)) {
      fail(`${entry.path}.fieldKey`, 'dangling_reference', 'references a missing secret field')
    }
  }
  for (const pin of state.pins) {
    const known = pin.kind === 'secret'
      ? state.secrets.has(pin.id)
      : pin.kind === 'project'
        ? state.projects.has(pin.id)
        : state.providers.has(pin.id)
    if (!known) fail(pin.path, 'dangling_reference', 'references a missing dashboard item')
  }
}

function validateEmbeddedImage(value: string, path: string, state: ValidationState): void {
  if (value === '') return
  if (value === REDACTED_SECRET_VALUE) {
    if (state.boundary === 'renderer') return
    fail(path, 'redacted_value', 'contains an unresolved redacted value')
  }
  // Attachment references are an internal persisted representation. They are
  // hydrated before crossing into the renderer and are never accepted from
  // imports, which prevents an external document from naming local blobs.
  if (state.boundary === 'persisted' && IMAGE_ATTACHMENT_REF_RE.test(value)) return
  const match = IMAGE_DATA_URL_RE.exec(value)
  if (!match) fail(path, 'image_format', 'must be a base64 image data URL')
  const base64 = match[1].replace(/[ \t\r\n]+/g, '')
  if (!isCanonicalBase64(base64)) fail(path, 'base64', 'contains invalid base64 image data')
  const byteLength = decodedBase64Bytes(base64)
  if (byteLength > VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes) {
    fail(path, 'limit', 'contains an image that is too large')
  }
  state.embeddedImageBytes += byteLength
  if (state.embeddedImageBytes > VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytesAggregate) {
    fail(path, 'limit', 'exceeds the aggregate embedded-image limit')
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'type', 'must be an object')
  return value
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'type', 'must be an array')
  if (value.length > max) fail(path, 'limit', 'contains too many items')
  return value
}

function optionalArray(value: unknown, path: string, max: number): unknown[] {
  return value === undefined ? [] : array(value, path, max)
}

function text(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean; max?: number } = {},
): string {
  if (typeof value !== 'string') fail(path, 'type', 'must be a string')
  if (!options.allowEmpty && value.length === 0) fail(path, 'required', 'must not be empty')
  if (options.max !== undefined && value.length > options.max) fail(path, 'limit', 'is too long')
  return value
}

function optionalText(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean; max?: number } = {},
): string | undefined {
  return value === undefined ? undefined : text(value, path, options)
}

function id(value: unknown, path: string): string {
  const result = text(value, path, { max: VAULT_VALIDATION_LIMITS.maxIdChars })
  if (/[\u0000-\u001f\u007f]/.test(result)) fail(path, 'format', 'contains control characters')
  return result
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'type', 'must be a boolean')
  return value
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  return value === undefined ? undefined : boolean(value, path)
}

function integer(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(path, 'type', 'must be a safe integer')
  }
  if (options.min !== undefined && value < options.min) fail(path, 'range', 'is below the supported range')
  if (options.max !== undefined && value > options.max) fail(path, 'range', 'is above the supported range')
  return value
}

function optionalInteger(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  return value === undefined ? undefined : integer(value, path, options)
}

function enumText(
  value: unknown,
  path: string,
  allowed: Set<string>,
  requirement: string,
): string {
  const result = text(value, path)
  if (!allowed.has(result)) fail(path, 'enum', requirement)
  return result
}

function optionalStringArray(value: unknown, path: string, maxItems: number, maxChars: number): void {
  if (value === undefined) return
  const values = array(value, path, maxItems)
  for (let index = 0; index < values.length; index += 1) {
    text(values[index], `${path}[${index}]`, { allowEmpty: true, max: maxChars })
  }
}

function isoDateTime(value: unknown, path: string): string {
  const result = text(value, path)
  if (!isIsoDateTime(result)) fail(path, 'format', 'must be an ISO 8601 date-time')
  return result
}

function optionalIsoDateTime(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : isoDateTime(value, path)
}

function optionalDateOrDateTime(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  const result = text(value, path)
  if (!isIsoDate(result) && !isIsoDateTime(result)) {
    fail(path, 'format', 'must be an ISO 8601 date or date-time')
  }
  return result
}

function hexText(value: unknown, path: string, minChars: number, maxChars: number): string {
  const result = text(value, path, { max: maxChars })
  if (
    result.length < minChars ||
    result.length % 2 !== 0 ||
    !HEX_RE.test(result)
  ) {
    fail(path, 'format', 'must be an even-length hexadecimal string')
  }
  return result
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isIsoDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || !isIsoDate(match[1])) return false
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false
  return Number.isFinite(Date.parse(value))
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

function addUnique<T>(
  set: Set<T> | Map<T, Set<string>>,
  value: T,
  path: string,
  label: string,
  mapValue?: Set<string>,
): void {
  if (set.has(value)) fail(path, 'duplicate_id', `duplicates a ${label} identifier`)
  if (set instanceof Map) set.set(value, mapValue ?? new Set())
  else set.add(value)
}

function safePathKey(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : '[configuration-key]'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fail(path: string, code: string, requirement: string): never {
  throw new VaultValidationError(path, code, requirement)
}
