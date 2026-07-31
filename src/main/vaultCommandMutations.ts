import { randomUUID } from 'crypto'
import type { VaultMutationCommand } from '../shared/vaultIpcContracts'
import { validateVaultRoot } from '../shared/vaultValidation'
import {
  legacySecretFieldId,
  mergeRedactedProviderValues,
  mergeRedactedSecretValues,
} from './vaultRedaction'

type Entity = Record<string, unknown>

interface TreeRef {
  kind: 'folder' | 'secret'
  id: string
}

interface Folder extends Entity {
  id: string
  name: string
  children: Folder[]
  secrets: Entity[]
  itemOrder?: TreeRef[]
}

interface VaultState extends Entity {
  version: number
  revision?: number
  root: Folder
  providers: Entity[]
  providerGroups?: Entity[]
  envProjects: Entity[]
  preferences?: Entity
}

export interface VaultCommandMutationOptions {
  randomId?: () => string
  now?: () => string
}

export interface VaultCommandMutationResult {
  vault: Record<string, unknown>
  result?: unknown
}

/**
 * Applies a renderer-requested semantic command to the latest main-process
 * snapshot. The renderer never supplies a replacement vault document. Every
 * result is subsequently checked by the canonical persisted-vault validator
 * before it is encrypted.
 */
export function applyVaultMutationCommand(
  current: unknown,
  command: VaultMutationCommand,
  options: VaultCommandMutationOptions = {},
): VaultCommandMutationResult {
  validateVaultRoot(current)
  // Upgrade legacy field labels to durable identities before applying any
  // semantic command. The deterministic IDs match the renderer redaction
  // boundary, so an old vault can be edited without a separate migration.
  const vault = normalizeLegacyFieldIdentity(current as VaultState)
  const randomId = options.randomId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())

  switch (command.type) {
    case 'bootstrap.defaults':
      return bootstrapDefaults(vault, command)
    case 'folder.create':
      return createFolder(vault, command)
    case 'folder.rename':
      return renameFolder(vault, command)
    case 'folder.delete':
      return deleteFolder(vault, command)
    case 'folder.duplicate':
      return duplicateFolder(vault, command, randomId, now())
    case 'folder.move-item':
      return moveTreeItem(vault, command)
    case 'folder.sort':
      return sortFolder(vault, command)
    case 'folder.import':
      return importFolder(vault, command, randomId, now())
    case 'secret.create-many':
      return createSecrets(vault, command, randomId)
    case 'secret.create-many-and-map':
      return createSecretsAndMap(vault, command, randomId)
    case 'secret.update':
      return updateSecret(vault, command, now(), randomId)
    case 'secret.provider-link.set':
      return setSecretProviderLink(vault, command, now())
    case 'secret.delete':
      return deleteSecret(vault, command)
    case 'provider.create':
      return createProvider(vault, command, randomId)
    case 'provider.update':
      return updateProvider(vault, command)
    case 'provider.update-with-secret':
      return updateProviderWithSecret(vault, command, now(), randomId)
    case 'provider.delete':
      return deleteProvider(vault, command)
    case 'provider-group.create':
      return createProviderGroup(vault, command)
    case 'provider-group.rename':
      return renameProviderGroup(vault, command)
    case 'provider-group.delete':
      return deleteProviderGroup(vault, command)
    case 'provider.move':
      return moveProvider(vault, command)
    case 'env-project.create':
      return createEnvProject(vault, command)
    case 'env-project.update':
      return updateEnvProject(vault, command)
    case 'env-project.update-many':
      return updateEnvProjects(vault, command)
    case 'env-project.delete':
      return deleteEnvProject(vault, command)
    case 'preferences.patch':
      return patchPreferences(vault, command)
  }
}

function bootstrapDefaults(vault: VaultState, command: Entity): VaultCommandMutationResult {
  if (vault.preferences?.localDefaultFoldersCreated === true) return { vault }
  const defaults = array(command.folders, 'default folders').map((value) => {
    const folder = record(value, 'default folder')
    return emptyFolder(id(folder.id, 'default folder id'), text(folder.name, 'default folder name'))
  })
  const existing = new Set(vault.root.children.map(folder => folder.name.trim().toLowerCase()))
  const additions = defaults.filter(folder => !existing.has(folder.name.trim().toLowerCase()))
  return {
    vault: {
      ...vault,
      root: additions.length === 0 ? vault.root : {
        ...vault.root,
        children: [...vault.root.children, ...additions],
        itemOrder: [
          ...orderedFolderItems(vault.root),
          ...additions.map(folder => ({ kind: 'folder' as const, id: folder.id })),
        ],
      },
      preferences: { ...(vault.preferences ?? {}), localDefaultFoldersCreated: true },
    },
  }
}

function createFolder(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const parentId = id(command.parentId, 'parent folder id')
  const input = record(command.folder, 'folder')
  const folder = emptyFolder(id(input.id, 'folder id'), text(input.name, 'folder name'))
  assertUniqueEntityId(vault, folder.id)
  return {
    vault: {
      ...vault,
      root: mapFolderRequired(vault.root, parentId, parent => ({
        ...parent,
        children: [...parent.children, folder],
        itemOrder: [...orderedFolderItems(parent), { kind: 'folder', id: folder.id }],
      })),
    },
  }
}

function renameFolder(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const name = text(command.name, 'folder name')
  return { vault: { ...vault, root: mapFolderRequired(vault.root, folderId, folder => ({ ...folder, name })) } }
}

function deleteFolder(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  if (folderId === vault.root.id) throw new Error('The vault root folder cannot be deleted')
  const folder = findFolder(vault.root, folderId)
  if (!folder) throw new Error('Folder no longer exists')
  const deletedSecretIds = new Set(secretIdsInFolder(folder))
  const next = removeSecretReferencesMany(
    { ...vault, root: removeFolder(vault.root, folderId) },
    deletedSecretIds,
  )
  return { vault: next, result: { rootId: vault.root.id } }
}

function duplicateFolder(
  vault: VaultState,
  command: Entity,
  randomId: () => string,
  now: string,
): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  if (folderId === vault.root.id) throw new Error('The vault root folder cannot be duplicated')
  const source = findFolderParent(vault.root, folderId)
  if (!source) throw new Error('Folder no longer exists')
  const cloned = cloneFolderTree(source.folder, undefined, randomId, now, false)
  if (!cloned) throw new Error('Folder could not be duplicated')
  cloned.folder.name = duplicateFolderName(findFolder(vault.root, source.parentId)!, source.folder.name)
  return {
    vault: {
      ...vault,
      root: mapFolderRequired(vault.root, source.parentId, parent => insertFolderAfter(parent, folderId, cloned.folder)),
    },
    result: {
      folderId: cloned.folder.id,
      firstSecretId: cloned.firstSecretId,
      secretCount: cloned.secretCount,
    },
  }
}

function moveTreeItem(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const item = treeRef(command.item, 'tree item')
  const target = moveTarget(command.target)
  const moved = moveVaultTreeItem(vault.root, item, target)
  if (!moved) throw new Error('Tree item can no longer be moved to that destination')
  return {
    vault: { ...vault, root: moved.root },
    result: {
      selectedFolderId: moved.selectedFolderId,
      selectedSecretId: moved.selectedSecretId,
    },
  }
}

function sortFolder(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const key = enumValue(command.key, ['title', 'createdAt', 'updatedAt', 'usageCount', 'lastUsedAt'], 'sort key')
  const direction = enumValue(command.direction, ['asc', 'desc'], 'sort direction')
  return {
    vault: {
      ...vault,
      root: mapFolderRequired(vault.root, folderId, folder => ({
        ...folder,
        itemOrder: sortFolderItemRefs(folder, { key, direction }),
      })),
    },
  }
}

function importFolder(
  vault: VaultState,
  command: Entity,
  randomId: () => string,
  now: string,
): VaultCommandMutationResult {
  const parentId = id(command.parentId, 'parent folder id')
  const source = asFolder(command.folder, 'import folder')
  const selected = command.selectedSecretIds === undefined
    ? undefined
    : new Set(array(command.selectedSecretIds, 'selected secret ids').map(value => id(value, 'selected secret id')))
  const cloned = cloneFolderTree(source, selected, randomId, now, false)
  if (!cloned) return { vault, result: { folderId: parentId, firstSecretId: null, secretCount: 0 } }
  return {
    vault: {
      ...vault,
      root: mapFolderRequired(vault.root, parentId, parent => ({
        ...parent,
        children: [...parent.children, cloned.folder],
        itemOrder: [...orderedFolderItems(parent), { kind: 'folder', id: cloned.folder.id }],
      })),
    },
    result: {
      folderId: cloned.folder.id,
      firstSecretId: cloned.firstSecretId,
      secretCount: cloned.secretCount,
    },
  }
}

function createSecrets(
  vault: VaultState,
  command: Entity,
  randomId: () => string,
): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const secrets = entities(command.secrets, 'secrets').map(secret => ensureSecretFieldIds(secret, randomId))
  assertUniqueEntityIds(vault, secrets.map(secret => id(secret.id, 'secret id')))
  return {
    vault: {
      ...vault,
      root: mapFolderRequired(vault.root, folderId, folder => ({
        ...folder,
        secrets: [...folder.secrets, ...secrets],
        itemOrder: [
          ...orderedFolderItems(folder),
          ...secrets.map(secret => ({ kind: 'secret' as const, id: id(secret.id, 'secret id') })),
        ],
      })),
    },
    result: { createdIds: secrets.map(secret => id(secret.id, 'secret id')) },
  }
}

function createSecretsAndMap(
  vault: VaultState,
  command: Entity,
  randomId: () => string,
): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const projectId = id(command.projectId, 'project id')
  const secrets = entities(command.secrets, 'secrets').map(secret => ensureSecretFieldIds(secret, randomId))
  const secretIds = secrets.map(secret => id(secret.id, 'secret id'))
  assertUniqueEntityIds(vault, secretIds)
  const entries = hydrateEnvEntries(
    entities(command.entries, 'environment entries'),
    secretFieldCatalog(vault.root, secrets),
  )
  const replacing = new Set(entries.map(entry => text(entry.envKey, 'environment key')))
  let foundProject = false
  const envProjects = vault.envProjects.map(project => {
    if (project.id !== projectId) return project
    foundProject = true
    const currentEntries = entities(project.entries ?? [], 'project entries')
    return {
      ...project,
      entries: [...currentEntries.filter(entry => !replacing.has(String(entry.envKey))), ...entries],
    }
  })
  if (!foundProject) throw new Error('Environment project no longer exists')
  return {
    vault: {
      ...vault,
      root: mapFolderRequired(vault.root, folderId, folder => ({
        ...folder,
        secrets: [...folder.secrets, ...secrets],
        itemOrder: [
          ...orderedFolderItems(folder),
          ...secrets.map(secret => ({ kind: 'secret' as const, id: id(secret.id, 'secret id') })),
        ],
      })),
      envProjects,
    },
    result: { createdIds: secrets.map(secret => id(secret.id, 'secret id')) },
  }
}

function updateSecret(
  vault: VaultState,
  command: Entity,
  now: string,
  randomId: () => string,
): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const incoming = record(command.secret, 'secret')
  const secretId = id(incoming.id, 'secret id')
  let found = false
  let previousSecret: Entity | null = null
  let nextSecret: Entity | null = null
  const root = mapFolderRequired(vault.root, folderId, folder => ({
    ...folder,
    secrets: folder.secrets.map(secret => {
      if (secret.id !== secretId) return secret
      found = true
      previousSecret = secret
      const merged = ensureSecretFieldIds(
        record(mergeRedactedSecretValues(incoming, secret), 'merged secret'),
        randomId,
      )
      // Remote lifecycle identity is main-owned. Generic form edits cannot
      // forge provider ownership, remote IDs, scopes, or verification state.
      if (secret.providerLink === undefined) delete merged.providerLink
      else merged.providerLink = structuredClone(secret.providerLink)
      nextSecret = {
        ...merged,
        id: secretId,
        createdAt: secret.createdAt,
        updatedAt: now,
        lastUsedAt: secret.lastUsedAt,
        usageCount: secret.usageCount,
      }
      return nextSecret
    }),
  }))
  if (!found) throw new Error('Secret no longer exists in that folder')
  return {
    vault: reconcileSecretFieldReferences(
      { ...vault, root },
      secretId,
      previousSecret!,
      nextSecret!,
    ),
  }
}

function setSecretProviderLink(
  vault: VaultState,
  command: Entity,
  now: string,
): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const secretId = id(command.secretId, 'secret id')
  const requested = command.link === null ? null : record(command.link, 'provider link update')
  if (requested) {
    const providerId = id(requested.providerId, 'provider link provider id')
    if (!vault.providers.some(provider => provider.id === providerId)) {
      throw new Error('Linked provider no longer exists')
    }
  }
  let found = false
  const root = mapFolderRequired(vault.root, folderId, folder => ({
    ...folder,
    secrets: folder.secrets.map(secret => {
      if (secret.id !== secretId) return secret
      found = true
      if (!requested) {
        const { providerLink: _removed, ...rest } = secret
        return rest
      }
      const providerId = id(requested.providerId, 'provider link provider id')
      const remoteName = text(requested.remoteName, 'provider link remote name')
      const status = enumValue(requested.status, ['active', 'revoked', 'missing'], 'provider link status')
      const previous = isRecord(secret.providerLink) && secret.providerLink.providerId === providerId
        ? secret.providerLink
        : null
      return {
        ...secret,
        providerLink: {
          providerId,
          remoteName,
          createdInVaultage: previous?.createdInVaultage === true,
          scopes: previous?.scopes,
          remoteId: previous?.remoteId,
          lastVerifiedAt: previous?.lastVerifiedAt,
          status,
          statusUpdatedAt: previous?.status === status ? previous.statusUpdatedAt : now,
        },
      }
    }),
  }))
  if (!found) throw new Error('Secret no longer exists in that folder')
  return { vault: { ...vault, root } }
}

function deleteSecret(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const folderId = id(command.folderId, 'folder id')
  const secretId = id(command.secretId, 'secret id')
  const folder = findFolder(vault.root, folderId)
  if (!folder?.secrets.some(secret => secret.id === secretId)) throw new Error('Secret no longer exists in that folder')
  return {
    vault: removeSecretReferences({
      ...vault,
      root: removeSecretFromFolder(vault.root, folderId, secretId),
    }, secretId),
  }
}

function createProvider(
  vault: VaultState,
  command: Entity,
  randomId: () => string,
): VaultCommandMutationResult {
  const provider = record(command.provider, 'provider')
  assertUniqueEntityId(vault, id(provider.id, 'provider id'))
  let providerGroups = [...(vault.providerGroups ?? [])]
  let groupId = optionalId(provider.groupId, 'provider group id')
  const categoryId = optionalText(command.categoryId, 'provider category id')
  const categoryLabel = optionalText(command.categoryLabel, 'provider category label')
  if (!groupId && categoryId && categoryLabel) {
    const existing = providerGroups.find(group => group.categoryId === categoryId)
      ?? providerGroups.find(group => String(group.name).toLowerCase() === categoryLabel.toLowerCase())
    if (existing) {
      groupId = id(existing.id, 'provider group id')
      if (existing.categoryId !== categoryId) {
        providerGroups = providerGroups.map(group => group.id === groupId ? { ...group, categoryId } : group)
      }
    } else {
      const group = { id: randomId(), name: categoryLabel, categoryId }
      providerGroups.push(group)
      groupId = group.id
    }
  }
  return {
    vault: {
      ...vault,
      providers: [...vault.providers, { ...provider, groupId: groupId ?? undefined }],
      providerGroups,
    },
  }
}

function updateProvider(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const incoming = record(command.provider, 'provider')
  const providerId = id(incoming.id, 'provider id')
  let found = false
  const providers = vault.providers.map(provider => {
    if (provider.id !== providerId) return provider
    found = true
    return { ...record(mergeRedactedProviderValues(incoming, provider), 'merged provider'), id: providerId }
  })
  if (!found) throw new Error('Provider no longer exists')
  return { vault: { ...vault, providers } }
}

function updateProviderWithSecret(
  vault: VaultState,
  command: Entity,
  now: string,
  randomId: () => string,
): VaultCommandMutationResult {
  const providerResult = updateProvider(vault, command)
  return updateSecret(providerResult.vault as VaultState, command, now, randomId)
}

function deleteProvider(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const providerId = id(command.providerId, 'provider id')
  if (!vault.providers.some(provider => provider.id === providerId)) throw new Error('Provider no longer exists')
  return {
    vault: removeProviderReferences({
      ...vault,
      providers: vault.providers.filter(provider => provider.id !== providerId),
    }, providerId),
  }
}

function createProviderGroup(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const group = record(command.group, 'provider group')
  assertUniqueEntityId(vault, id(group.id, 'provider group id'))
  return { vault: { ...vault, providerGroups: [...(vault.providerGroups ?? []), group] } }
}

function renameProviderGroup(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const groupId = id(command.groupId, 'provider group id')
  const name = text(command.name, 'provider group name')
  let found = false
  const providerGroups = (vault.providerGroups ?? []).map(group => {
    if (group.id !== groupId) return group
    found = true
    return { ...group, name }
  })
  if (!found) throw new Error('Provider group no longer exists')
  return { vault: { ...vault, providerGroups } }
}

function deleteProviderGroup(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const groupId = id(command.groupId, 'provider group id')
  if (!(vault.providerGroups ?? []).some(group => group.id === groupId)) throw new Error('Provider group no longer exists')
  return {
    vault: {
      ...vault,
      providerGroups: (vault.providerGroups ?? []).filter(group => group.id !== groupId),
      providers: vault.providers.map(provider => provider.groupId === groupId
        ? { ...provider, groupId: undefined }
        : provider),
    },
  }
}

function moveProvider(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const providerId = id(command.providerId, 'provider id')
  const groupId = optionalId(command.groupId, 'provider group id')
  const targetProviderId = optionalId(command.targetProviderId, 'target provider id')
  const position = command.position === undefined
    ? undefined
    : enumValue(command.position, ['before', 'after'], 'provider move position')
  const provider = vault.providers.find(candidate => candidate.id === providerId)
  if (!provider) throw new Error('Provider no longer exists')
  if (groupId && !(vault.providerGroups ?? []).some(group => group.id === groupId)) {
    throw new Error('Target provider group no longer exists')
  }
  if (targetProviderId === providerId) throw new Error('Provider cannot be moved relative to itself')
  if (position && !targetProviderId) throw new Error('A relative provider move requires a target provider')
  if (targetProviderId) {
    const targetProvider = vault.providers.find(candidate => candidate.id === targetProviderId)
    if (!targetProvider) throw new Error('Target provider no longer exists')
    if ((targetProvider.groupId ?? null) !== (groupId ?? null)) {
      throw new Error('Target provider is not in the destination group')
    }
  }
  return {
    vault: {
      ...vault,
      providers: insertProvider(vault.providers, provider, groupId ?? null, targetProviderId, position),
    },
  }
}

function createEnvProject(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const project = hydrateProjectEntries(
    record(command.project, 'environment project'),
    secretFieldCatalog(vault.root),
  )
  assertUniqueEntityId(vault, id(project.id, 'environment project id'))
  return { vault: {
    ...vault,
    envProjects: [...vault.envProjects, project],
  } }
}

function updateEnvProject(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const project = hydrateProjectEntries(
    record(command.project, 'environment project'),
    secretFieldCatalog(vault.root),
  )
  const projectId = id(project.id, 'environment project id')
  let found = false
  const envProjects = vault.envProjects.map(current => {
    if (current.id !== projectId) return current
    found = true
    return { ...project, id: projectId }
  })
  if (!found) throw new Error('Environment project no longer exists')
  return { vault: { ...vault, envProjects } }
}

function updateEnvProjects(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const catalog = secretFieldCatalog(vault.root)
  const projects = entities(command.projects, 'environment projects')
    .map(project => hydrateProjectEntries(project, catalog))
  const byId = new Map<string, Entity>()
  for (const project of projects) {
    const projectId = id(project.id, 'environment project id')
    if (byId.has(projectId)) throw new Error('Duplicate environment project id in update batch')
    byId.set(projectId, project)
  }
  for (const projectId of byId.keys()) {
    if (!vault.envProjects.some(project => project.id === projectId)) {
      throw new Error('An environment project no longer exists')
    }
  }
  return {
    vault: {
      ...vault,
      envProjects: vault.envProjects.map(project => byId.get(String(project.id)) ?? project),
    },
  }
}

function deleteEnvProject(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const projectId = id(command.projectId, 'environment project id')
  if (!vault.envProjects.some(project => project.id === projectId)) throw new Error('Environment project no longer exists')
  return {
    vault: {
      ...vault,
      envProjects: vault.envProjects.filter(project => project.id !== projectId),
      preferences: removeActiveProjectPreference(
        removePinnedPreference(vault.preferences, 'project', projectId),
        projectId,
      ),
    },
  }
}

function activeEnvProjectIds(preferences: Entity | undefined): string[] {
  if (!Array.isArray(preferences?.activeEnvProjectIds)) return []
  return preferences.activeEnvProjectIds
    .filter((value): value is string => typeof value === 'string')
    .filter((value, index, values) => values.indexOf(value) === index)
}

function removeActiveProjectPreference(preferences: Entity | undefined, projectId: string): Entity | undefined {
  if (!preferences || !Array.isArray(preferences.activeEnvProjectIds)) return preferences
  return {
    ...preferences,
    activeEnvProjectIds: activeEnvProjectIds(preferences).filter(activeId => activeId !== projectId),
  }
}

function patchPreferences(vault: VaultState, command: Entity): VaultCommandMutationResult {
  const patch = { ...record(command.patch, 'preferences patch') }
  // Reveal credentials are changed only through the dedicated password- and
  // presence-protected IPC handlers, never by a renderer preference patch.
  delete patch.quickRevealPin
  delete patch.quickRevealPinEnabled
  // Free-tier activation is main-authorized only through env-project.activate.
  delete patch.activeEnvProjectIds
  return { vault: { ...vault, preferences: { ...(vault.preferences ?? {}), ...patch } } }
}

function mapFolderRequired(root: Folder, folderId: string, fn: (folder: Folder) => Folder): Folder {
  let found = false
  const visit = (folder: Folder): Folder => {
    if (folder.id === folderId) {
      found = true
      return fn(folder)
    }
    return { ...folder, children: folder.children.map(visit) }
  }
  const next = visit(root)
  if (!found) throw new Error('Folder no longer exists')
  return next
}

function findFolder(root: Folder, folderId: string): Folder | null {
  if (root.id === folderId) return root
  for (const child of root.children) {
    const found = findFolder(child, folderId)
    if (found) return found
  }
  return null
}

function findFolderParent(root: Folder, folderId: string): { folder: Folder; parentId: string } | null {
  for (const child of root.children) {
    if (child.id === folderId) return { folder: child, parentId: root.id }
    const found = findFolderParent(child, folderId)
    if (found) return found
  }
  return null
}

function findSecret(root: Folder, secretId: string): { secret: Entity; folderId: string } | null {
  const secret = root.secrets.find(candidate => candidate.id === secretId)
  if (secret) return { secret, folderId: root.id }
  for (const child of root.children) {
    const found = findSecret(child, secretId)
    if (found) return found
  }
  return null
}

function removeFolder(root: Folder, folderId: string): Folder {
  return {
    ...root,
    children: root.children.filter(child => child.id !== folderId).map(child => removeFolder(child, folderId)),
    itemOrder: orderedFolderItems(root).filter(item => !(item.kind === 'folder' && item.id === folderId)),
  }
}

function removeSecretFromFolder(root: Folder, folderId: string, secretId: string): Folder {
  return mapFolderRequired(root, folderId, folder => ({
    ...folder,
    secrets: folder.secrets.filter(secret => secret.id !== secretId),
    itemOrder: orderedFolderItems(folder).filter(item => !(item.kind === 'secret' && item.id === secretId)),
  }))
}

function secretIdsInFolder(folder: Folder): string[] {
  return [
    ...folder.secrets.map(secret => id(secret.id, 'secret id')),
    ...folder.children.flatMap(secretIdsInFolder),
  ]
}

function removeSecretReferences(vault: VaultState, secretId: string): VaultState {
  return removeSecretReferencesMany(vault, new Set([secretId]))
}

function removeSecretReferencesMany(vault: VaultState, secretIds: ReadonlySet<string>): VaultState {
  if (secretIds.size === 0) return vault
  return {
    ...vault,
    envProjects: vault.envProjects.map(project => ({
      ...project,
      entries: entities(project.entries ?? [], 'project entries').filter(entry => !secretIds.has(String(entry.secretId))),
      environments: project.environments === undefined ? undefined : entities(project.environments, 'project environments').map(environment => ({
        ...environment,
        entries: entities(environment.entries ?? [], 'environment entries').filter(entry => !secretIds.has(String(entry.secretId))),
      })),
    })),
    preferences: removePinnedSecretPreferences(vault.preferences, secretIds),
  }
}

function removePinnedSecretPreferences(
  preferences: Entity | undefined,
  secretIds: ReadonlySet<string>,
): Entity | undefined {
  if (!preferences || !Array.isArray(preferences.localDashboardPinnedOrder)) return preferences
  return {
    ...preferences,
    localDashboardPinnedOrder: preferences.localDashboardPinnedOrder.filter((item) => {
      if (typeof item !== 'string') return true
      const secretId = item.startsWith('secret:') ? item.slice('secret:'.length) : item
      return !secretIds.has(secretId)
    }),
  }
}

function removeProviderReferences(vault: VaultState, providerId: string): VaultState {
  const clearLinks = (folder: Folder): Folder => ({
    ...folder,
    secrets: folder.secrets.map(secret => {
      const link = isRecord(secret.providerLink) ? secret.providerLink : null
      if (link?.providerId !== providerId) return secret
      const { providerLink: _removed, ...rest } = secret
      return rest
    }),
    children: folder.children.map(clearLinks),
  })
  return {
    ...vault,
    root: clearLinks(vault.root),
    envProjects: vault.envProjects.map(project => ({
      ...project,
      environments: project.environments === undefined ? undefined : entities(project.environments, 'project environments').map(environment => {
        if (environment.providerId !== providerId) return environment
        const {
          providerId: _providerId,
          providerEnvName: _providerEnvName,
          providerBinding: _providerBinding,
          ...rest
        } = environment
        return { ...rest, syncRule: 'manual' }
      }),
    })),
    preferences: removePinnedPreference(vault.preferences, 'service', providerId),
  }
}

function removePinnedPreference(
  preferences: Entity | undefined,
  kind: 'secret' | 'project' | 'service',
  entityId: string,
): Entity | undefined {
  if (!preferences || !Array.isArray(preferences.localDashboardPinnedOrder)) return preferences
  const target = `${kind}:${entityId}`
  return {
    ...preferences,
    localDashboardPinnedOrder: preferences.localDashboardPinnedOrder.filter(item => item !== target && item !== entityId),
  }
}

interface MoveTarget {
  folderId: string
  position: 'inside' | 'before' | 'after'
  target?: TreeRef
}

function moveVaultTreeItem(
  root: Folder,
  item: TreeRef,
  target: MoveTarget,
): { root: Folder; selectedFolderId?: string; selectedSecretId?: string } | null {
  if (target.position !== 'inside' && target.target?.kind === item.kind && target.target.id === item.id) return null
  if (item.kind === 'folder') {
    if (item.id === root.id || target.folderId === item.id) return null
    const source = findFolderParent(root, item.id)
    if (!source || folderContainsFolder(source.folder, target.folderId)) return null
    const detached = removeFolder(root, item.id)
    if (!findFolder(detached, target.folderId)) return null
    return {
      root: insertTreeItem(detached, target.folderId, { kind: 'folder', value: source.folder }, target),
      selectedFolderId: item.id,
    }
  }
  const source = findSecret(root, item.id)
  if (!source) return null
  const detached = removeSecretFromFolder(root, source.folderId, item.id)
  if (!findFolder(detached, target.folderId)) return null
  return {
    root: insertTreeItem(detached, target.folderId, { kind: 'secret', value: source.secret }, target),
    selectedFolderId: target.folderId,
    selectedSecretId: item.id,
  }
}

function folderContainsFolder(folder: Folder, folderId: string): boolean {
  return folder.children.some(child => child.id === folderId || folderContainsFolder(child, folderId))
}

function insertTreeItem(
  root: Folder,
  folderId: string,
  item: { kind: 'folder'; value: Folder } | { kind: 'secret'; value: Entity },
  target: MoveTarget,
): Folder {
  return mapFolderRequired(root, folderId, folder => {
    const nextRef: TreeRef = { kind: item.kind, id: id(item.value.id, `${item.kind} id`) }
    const currentOrder = orderedFolderItems(folder).filter(ref => !(ref.kind === nextRef.kind && ref.id === nextRef.id))
    let insertAt = currentOrder.length
    if (target.position !== 'inside' && target.target) {
      const targetIndex = currentOrder.findIndex(ref => ref.kind === target.target!.kind && ref.id === target.target!.id)
      if (targetIndex < 0) throw new Error('Relative tree move target no longer exists in the destination folder')
      insertAt = target.position === 'before' ? targetIndex : targetIndex + 1
    }
    const itemOrder = [...currentOrder.slice(0, insertAt), nextRef, ...currentOrder.slice(insertAt)]
    return item.kind === 'folder'
      ? { ...folder, children: [...folder.children, item.value], itemOrder }
      : { ...folder, secrets: [...folder.secrets, item.value], itemOrder }
  })
}

function orderedFolderItems(folder: Folder): TreeRef[] {
  const known = new Set([
    ...folder.children.map(child => `folder:${child.id}`),
    ...folder.secrets.map(secret => `secret:${String(secret.id)}`),
  ])
  const seen = new Set<string>()
  const order: TreeRef[] = []
  for (const value of Array.isArray(folder.itemOrder) ? folder.itemOrder : []) {
    if (!isRecord(value) || (value.kind !== 'folder' && value.kind !== 'secret') || typeof value.id !== 'string') continue
    const key = `${value.kind}:${value.id}`
    if (!known.has(key) || seen.has(key)) continue
    seen.add(key)
    order.push({ kind: value.kind, id: value.id })
  }
  for (const child of folder.children) {
    const key = `folder:${child.id}`
    if (!seen.has(key)) order.push({ kind: 'folder', id: child.id })
  }
  for (const secret of folder.secrets) {
    const secretId = id(secret.id, 'secret id')
    const key = `secret:${secretId}`
    if (!seen.has(key)) order.push({ kind: 'secret', id: secretId })
  }
  return order
}

type SortKey = 'title' | 'createdAt' | 'updatedAt' | 'usageCount' | 'lastUsedAt'

function sortFolderItemRefs(folder: Folder, options: { key: SortKey; direction: 'asc' | 'desc' }): TreeRef[] {
  const direction = options.direction === 'asc' ? 1 : -1
  return [...orderedFolderItems(folder)].sort((left, right) => {
    const a = folderSortMeta(folder, left)
    const b = folderSortMeta(folder, right)
    const delta = compareSortValue(a[options.key], b[options.key])
    if (delta !== 0) return delta * direction
    const title = String(a.title).localeCompare(String(b.title))
    return title !== 0 ? title : left.kind.localeCompare(right.kind)
  })
}

function folderSortMeta(folder: Folder, ref: TreeRef): Record<SortKey, string | number> {
  if (ref.kind === 'secret') {
    const secret = folder.secrets.find(item => item.id === ref.id)
    return secret ? entitySortMeta(secret) : emptySortMeta()
  }
  const child = folder.children.find(item => item.id === ref.id)
  return child ? folderAggregateSortMeta(child) : emptySortMeta()
}

function entitySortMeta(entity: Entity): Record<SortKey, string | number> {
  return {
    title: typeof entity.name === 'string' ? entity.name : '',
    createdAt: timestamp(entity.createdAt),
    updatedAt: timestamp(entity.updatedAt),
    usageCount: typeof entity.usageCount === 'number' ? entity.usageCount : 0,
    lastUsedAt: timestamp(entity.lastUsedAt),
  }
}

function folderAggregateSortMeta(folder: Folder): Record<SortKey, string | number> {
  const children = [...folder.secrets.map(entitySortMeta), ...folder.children.map(folderAggregateSortMeta)]
  return {
    title: folder.name,
    createdAt: minPositive(children.map(item => Number(item.createdAt))),
    updatedAt: Math.max(0, ...children.map(item => Number(item.updatedAt))),
    usageCount: children.reduce((sum, item) => sum + Number(item.usageCount), 0),
    lastUsedAt: Math.max(0, ...children.map(item => Number(item.lastUsedAt))),
  }
}

function emptySortMeta(): Record<SortKey, string | number> {
  return { title: '', createdAt: 0, updatedAt: 0, usageCount: 0, lastUsedAt: 0 }
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function minPositive(values: number[]): number {
  const positive = values.filter(value => value > 0)
  return positive.length > 0 ? Math.min(...positive) : 0
}

function compareSortValue(left: string | number, right: string | number): number {
  return typeof left === 'string' || typeof right === 'string'
    ? String(left).localeCompare(String(right))
    : left - right
}

function insertProvider(
  providers: Entity[],
  provider: Entity,
  targetGroupId: string | null,
  targetProviderId?: string,
  position?: 'before' | 'after',
): Entity[] {
  const nextProvider = { ...provider, groupId: targetGroupId ?? undefined }
  const remaining = providers.filter(candidate => candidate.id !== provider.id)
  if (targetProviderId && position) {
    const index = remaining.findIndex(candidate => candidate.id === targetProviderId)
    if (index < 0) throw new Error('Target provider no longer exists')
    const insertAt = position === 'before' ? index : index + 1
    return [...remaining.slice(0, insertAt), nextProvider, ...remaining.slice(insertAt)]
  }
  const lastInGroup = remaining.reduce(
    (last, candidate, index) => ((candidate.groupId ?? null) === targetGroupId ? index : last),
    -1,
  )
  const insertAt = lastInGroup >= 0 ? lastInGroup + 1 : remaining.length
  return [...remaining.slice(0, insertAt), nextProvider, ...remaining.slice(insertAt)]
}

interface ClonedFolder {
  oldId: string
  folder: Folder
  firstSecretId: string | null
  secretCount: number
}

function cloneFolderTree(
  source: Folder,
  selectedSecretIds: Set<string> | undefined,
  randomId: () => string,
  now: string,
  preserveProviderLinks: boolean,
): ClonedFolder | null {
  const secrets = source.secrets
    .filter(secret => !selectedSecretIds || selectedSecretIds.has(id(secret.id, 'secret id')))
    .map(secret => ({
      oldId: id(secret.id, 'secret id'),
      secret: cloneSecret(secret, randomId(), now, randomId, preserveProviderLinks),
    }))
  const children = source.children
    .map(child => cloneFolderTree(child, selectedSecretIds, randomId, now, preserveProviderLinks))
    .filter((child): child is ClonedFolder => Boolean(child))
  if (selectedSecretIds && secrets.length === 0 && children.length === 0) return null
  const secretIds = new Map(secrets.map(pair => [pair.oldId, id(pair.secret.id, 'secret id')]))
  const folderIds = new Map(children.map(pair => [pair.oldId, pair.folder.id]))
  const itemOrder: TreeRef[] = []
  const seen = new Set<string>()
  for (const item of orderedFolderItems(source)) {
    const nextId = item.kind === 'folder' ? folderIds.get(item.id) : secretIds.get(item.id)
    if (!nextId) continue
    const key = `${item.kind}:${nextId}`
    if (seen.has(key)) continue
    seen.add(key)
    itemOrder.push({ kind: item.kind, id: nextId })
  }
  for (const pair of secrets) {
    const secretId = id(pair.secret.id, 'secret id')
    if (!seen.has(`secret:${secretId}`)) itemOrder.push({ kind: 'secret', id: secretId })
  }
  for (const pair of children) {
    if (!seen.has(`folder:${pair.folder.id}`)) itemOrder.push({ kind: 'folder', id: pair.folder.id })
  }
  const folder: Folder = {
    ...source,
    id: randomId(),
    name: source.name.trim() || 'Imported folder',
    children: children.map(pair => pair.folder),
    secrets: secrets.map(pair => pair.secret),
    itemOrder,
  }
  return {
    oldId: source.id,
    folder,
    firstSecretId: firstSecretInFolder(folder),
    secretCount: secrets.length + children.reduce((sum, child) => sum + child.secretCount, 0),
  }
}

function cloneSecret(
  secret: Entity,
  secretId: string,
  now: string,
  randomId: () => string,
  preserveProviderLinks: boolean,
): Entity {
  const cloned: Entity = {
    ...structuredClone(secret),
    id: secretId,
    createdAt: now,
    updatedAt: now,
  }
  delete cloned.usageCount
  delete cloned.lastUsedAt
  if (!preserveProviderLinks) delete cloned.providerLink
  return ensureSecretFieldIds(cloned, randomId)
}

function firstSecretInFolder(folder: Folder): string | null {
  for (const item of orderedFolderItems(folder)) {
    if (item.kind === 'secret' && folder.secrets.some(secret => secret.id === item.id)) return item.id
    if (item.kind === 'folder') {
      const child = folder.children.find(candidate => candidate.id === item.id)
      if (!child) continue
      const nested = firstSecretInFolder(child)
      if (nested) return nested
    }
  }
  return null
}

function duplicateFolderName(parent: Folder, originalName: string): string {
  const base = `${originalName.trim() || 'Folder'} copy`
  const names = new Set(parent.children.map(folder => folder.name.trim().toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  let index = 2
  while (names.has(`${base} ${index}`.toLowerCase())) index += 1
  return `${base} ${index}`
}

function insertFolderAfter(parent: Folder, originalId: string, folder: Folder): Folder {
  const order = orderedFolderItems(parent)
  const originalIndex = order.findIndex(item => item.kind === 'folder' && item.id === originalId)
  const insertAt = originalIndex >= 0 ? originalIndex + 1 : order.length
  return {
    ...parent,
    children: [...parent.children, folder],
    itemOrder: [...order.slice(0, insertAt), { kind: 'folder', id: folder.id }, ...order.slice(insertAt)],
  }
}

function emptyFolder(folderId: string, name: string): Folder {
  return { id: folderId, name, children: [], secrets: [], itemOrder: [] }
}

function asFolder(value: unknown, label: string): Folder {
  const folder = record(value, label)
  return {
    ...folder,
    id: id(folder.id, `${label} id`),
    name: text(folder.name, `${label} name`),
    children: array(folder.children ?? [], `${label} children`).map(child => asFolder(child, 'child folder')),
    secrets: entities(folder.secrets ?? [], `${label} secrets`),
    itemOrder: Array.isArray(folder.itemOrder)
      ? folder.itemOrder.map(item => treeRef(item, 'folder item order'))
      : undefined,
  }
}

interface SecretFieldDescriptor {
  id: string
  key: string
}

type SecretFieldCatalog = Map<string, SecretFieldDescriptor[]>

function normalizeLegacyFieldIdentity(vault: VaultState): VaultState {
  const normalizeFolder = (folder: Folder): Folder => ({
    ...folder,
    secrets: folder.secrets.map(normalizeLegacySecretFieldIds),
    children: folder.children.map(normalizeFolder),
  })
  const root = normalizeFolder(vault.root)
  const catalog = secretFieldCatalog(root)
  return {
    ...vault,
    root,
    envProjects: vault.envProjects.map(project => normalizeLegacyProjectEntries(project, catalog)),
  }
}

function normalizeLegacySecretFieldIds(secret: Entity): Entity {
  if (!Array.isArray(secret.fields)) return secret
  const secretId = id(secret.id, 'secret id')
  const occurrences = new Map<string, number>()
  const seen = new Set<string>()
  const fields = secret.fields.map((value) => {
    const field = record(value, 'secret field')
    const key = text(field.key, 'secret field key')
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const fieldId = field.id === undefined
      ? legacySecretFieldId(secretId, key, occurrence)
      : id(field.id, 'secret field id')
    if (seen.has(fieldId)) throw new Error('Duplicate secret field id')
    seen.add(fieldId)
    return field.id === fieldId ? field : { ...field, id: fieldId }
  })
  return { ...secret, fields }
}

function ensureSecretFieldIds(secret: Entity, randomId: () => string): Entity {
  if (!Array.isArray(secret.fields)) return secret
  const seen = new Set<string>()
  const fields = secret.fields.map((value) => {
    const field = record(value, 'secret field')
    let fieldId = optionalId(field.id, 'secret field id')
    if (!fieldId) {
      for (let attempt = 0; attempt < 100 && !fieldId; attempt += 1) {
        const candidate = id(randomId(), 'generated secret field id')
        if (!seen.has(candidate)) fieldId = candidate
      }
      if (!fieldId) throw new Error('Could not allocate a unique secret field id')
    }
    if (seen.has(fieldId)) throw new Error('Duplicate secret field id')
    seen.add(fieldId)
    return { ...field, id: fieldId }
  })
  return { ...secret, fields }
}

function secretFieldCatalog(root: Folder, additionalSecrets: Entity[] = []): SecretFieldCatalog {
  const catalog: SecretFieldCatalog = new Map()
  const add = (secret: Entity): void => {
    const secretId = id(secret.id, 'secret id')
    const fields = entities(secret.fields ?? [], 'secret fields').map(field => ({
      id: id(field.id, 'secret field id'),
      key: text(field.key, 'secret field key'),
    }))
    catalog.set(secretId, fields)
  }
  const visit = (folder: Folder): void => {
    folder.secrets.forEach(add)
    folder.children.forEach(visit)
  }
  visit(root)
  additionalSecrets.forEach(add)
  return catalog
}

function hydrateEnvEntries(entries: Entity[], catalog: SecretFieldCatalog): Entity[] {
  return entries.map((entry) => {
    const secretId = id(entry.secretId, 'environment entry secret id')
    const fieldKey = text(entry.fieldKey, 'environment entry field key')
    const fields = catalog.get(secretId)
    if (!fields) throw new Error('Environment entry references a missing secret')
    const suppliedFieldId = optionalId(entry.fieldId, 'environment entry field id')
    if (suppliedFieldId) {
      const field = fields.find(candidate => candidate.id === suppliedFieldId)
      if (!field) throw new Error('Environment entry references a missing secret field')
      if (field.key !== fieldKey) throw new Error('Environment entry field label is stale')
      return { ...entry, fieldId: suppliedFieldId }
    }
    const matches = fields.filter(field => field.key === fieldKey)
    if (matches.length === 0) throw new Error('Environment entry references a missing secret field')
    if (matches.length > 1) throw new Error('Environment entry field label is ambiguous; select a stable field')
    return { ...entry, fieldId: matches[0].id }
  })
}

function normalizeLegacyProjectEntries(project: Entity, catalog: SecretFieldCatalog): Entity {
  const normalizeEntries = (value: unknown): Entity[] => entities(value ?? [], 'environment entries').map((entry) => {
    if (entry.fieldId !== undefined) return entry
    const fields = typeof entry.secretId === 'string' ? catalog.get(entry.secretId) : undefined
    const matches = fields?.filter(field => field.key === entry.fieldKey) ?? []
    return matches.length === 1 ? { ...entry, fieldId: matches[0].id } : entry
  })
  return {
    ...project,
    entries: normalizeEntries(project.entries),
    environments: project.environments === undefined
      ? undefined
      : entities(project.environments, 'project environments').map(environment => ({
          ...environment,
          entries: normalizeEntries(environment.entries),
        })),
  }
}

function hydrateProjectEntries(project: Entity, catalog: SecretFieldCatalog): Entity {
  return {
    ...project,
    entries: hydrateEnvEntries(entities(project.entries ?? [], 'project entries'), catalog),
    environments: project.environments === undefined
      ? undefined
      : entities(project.environments, 'project environments').map(environment => ({
          ...environment,
          entries: hydrateEnvEntries(entities(environment.entries ?? [], 'environment entries'), catalog),
        })),
  }
}

function reconcileSecretFieldReferences(
  vault: VaultState,
  secretId: string,
  previousSecret: Entity,
  nextSecret: Entity,
): VaultState {
  const previousFields = entities(previousSecret.fields ?? [], 'previous secret fields').map(field => ({
    id: id(field.id, 'previous secret field id'),
    key: text(field.key, 'previous secret field key'),
  }))
  const nextById = new Map(entities(nextSecret.fields ?? [], 'updated secret fields').map(field => [
    id(field.id, 'updated secret field id'),
    text(field.key, 'updated secret field key'),
  ]))
  const reconcileEntries = (value: unknown): Entity[] => entities(value ?? [], 'environment entries').flatMap((entry) => {
    if (entry.secretId !== secretId) return [entry]
    let fieldId = optionalId(entry.fieldId, 'environment entry field id')
    if (!fieldId) {
      const matches = previousFields.filter(field => field.key === entry.fieldKey)
      if (matches.length !== 1) {
        throw new Error('Legacy environment mapping is ambiguous; remap it before editing this secret')
      }
      fieldId = matches[0].id
    }
    const nextKey = nextById.get(fieldId)
    // Deleting a field atomically removes mappings that can no longer resolve.
    return nextKey === undefined ? [] : [{ ...entry, fieldId, fieldKey: nextKey }]
  })
  return {
    ...vault,
    envProjects: vault.envProjects.map(project => ({
      ...project,
      entries: reconcileEntries(project.entries),
      environments: project.environments === undefined
        ? undefined
        : entities(project.environments, 'project environments').map(environment => ({
            ...environment,
            entries: reconcileEntries(environment.entries),
          })),
    })),
  }
}

function collectEntityIds(vault: VaultState): Set<string> {
  const ids = new Set<string>()
  const visit = (folder: Folder): void => {
    ids.add(folder.id)
    folder.secrets.forEach(secret => ids.add(id(secret.id, 'secret id')))
    folder.children.forEach(visit)
  }
  visit(vault.root)
  vault.providers.forEach(provider => ids.add(id(provider.id, 'provider id')))
  ;(vault.providerGroups ?? []).forEach(group => ids.add(id(group.id, 'provider group id')))
  vault.envProjects.forEach(project => ids.add(id(project.id, 'environment project id')))
  return ids
}

function assertUniqueEntityIds(vault: VaultState, entityIds: string[]): void {
  const known = collectEntityIds(vault)
  for (const entityId of entityIds) {
    if (known.has(entityId)) throw new Error('Entity id already exists')
    known.add(entityId)
  }
}

function assertUniqueEntityId(vault: VaultState, entityId: string): void {
  if (
    findFolder(vault.root, entityId)
    || findSecret(vault.root, entityId)
    || vault.providers.some(provider => provider.id === entityId)
    || (vault.providerGroups ?? []).some(group => group.id === entityId)
    || vault.envProjects.some(project => project.id === entityId)
  ) throw new Error('Entity id already exists')
}

function moveTarget(value: unknown): MoveTarget {
  const target = record(value, 'tree move target')
  const result: MoveTarget = {
    folderId: id(target.folderId, 'target folder id'),
    position: enumValue(target.position, ['inside', 'before', 'after'], 'tree move position'),
    target: target.target === undefined ? undefined : treeRef(target.target, 'target tree item'),
  }
  if (result.position !== 'inside' && !result.target) {
    throw new Error('A relative tree move requires a target item')
  }
  return result
}

function treeRef(value: unknown, label: string): TreeRef {
  const ref = record(value, label)
  return {
    kind: enumValue(ref.kind, ['folder', 'secret'], `${label} kind`),
    id: id(ref.id, `${label} id`),
  }
}

function entities(value: unknown, label: string): Entity[] {
  return array(value, label).map(item => record(item, label))
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function record(value: unknown, label: string): Entity {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function isRecord(value: unknown): value is Entity {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function id(value: unknown, label: string): string {
  const result = text(value, label).trim()
  if (!result || result.length > 240 || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`Invalid ${label}`)
  return result
}

function optionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return id(value, label)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return text(value, label)
}

function enumValue<const T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Invalid ${label}`)
  return value as T
}
