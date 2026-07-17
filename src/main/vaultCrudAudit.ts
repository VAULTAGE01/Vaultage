import type { AuditEventType } from './audit'

const MAX_AUDIT_ENTITY_IDS = 50

export interface VaultCrudAuditEntry {
  type: AuditEventType
  details: Record<string, unknown>
}

interface IndexedEntity {
  value: Record<string, unknown>
  parentId?: string
}

interface VaultEntityIndexes {
  folders: Map<string, IndexedEntity>
  secrets: Map<string, IndexedEntity>
  projects: Map<string, IndexedEntity>
  providers: Map<string, IndexedEntity>
  providerGroups: Map<string, IndexedEntity>
  preferences: Record<string, unknown> | null
}

/**
 * Derives redacted semantic audit summaries for renderer-originated full-vault
 * saves. Values are compared only in memory and are never copied into event
 * details; each event contains bounded entity identifiers and counts.
 */
export function deriveVaultCrudAuditEntries(
  before: unknown,
  after: unknown,
  revision: number,
): VaultCrudAuditEntry[] {
  const previous = indexVaultEntities(before)
  const next = indexVaultEntities(after)
  const events: VaultCrudAuditEntry[] = []

  appendEntityChanges(events, previous.folders, next.folders, {
    created: 'vault.folder.created',
    updated: 'vault.folder.updated',
    deleted: 'vault.folder.deleted',
    entityKind: 'folder',
    revision,
    omitForComparison: new Set(['children', 'secrets']),
  })
  appendEntityChanges(events, previous.secrets, next.secrets, {
    created: 'vault.secret.created',
    updated: 'vault.secret.updated',
    deleted: 'vault.secret.deleted',
    entityKind: 'secret',
    revision,
  })
  appendEntityChanges(events, previous.projects, next.projects, {
    created: 'vault.env_project.created',
    updated: 'vault.env_project.updated',
    deleted: 'vault.env_project.deleted',
    entityKind: 'env-project',
    revision,
  })
  appendEntityChanges(events, previous.providers, next.providers, {
    created: 'vault.provider_config.created',
    updated: 'vault.provider_config.updated',
    deleted: 'vault.provider_config.deleted',
    entityKind: 'provider-config',
    revision,
  })
  appendEntityChanges(events, previous.providerGroups, next.providerGroups, {
    created: 'vault.provider_group.created',
    updated: 'vault.provider_group.updated',
    deleted: 'vault.provider_group.deleted',
    entityKind: 'provider-group',
    revision,
  })

  if (!recordsEqual(previous.preferences, next.preferences)) {
    events.push({
      type: 'vault.preferences.updated',
      details: { revision },
    })
  }
  return events
}

function appendEntityChanges(
  events: VaultCrudAuditEntry[],
  before: Map<string, IndexedEntity>,
  after: Map<string, IndexedEntity>,
  options: {
    created: AuditEventType
    updated: AuditEventType
    deleted: AuditEventType
    entityKind: string
    revision: number
    omitForComparison?: Set<string>
  },
): void {
  const created: string[] = []
  const updated: string[] = []
  const deleted: string[] = []

  for (const [id, entity] of after) {
    const old = before.get(id)
    if (!old) {
      created.push(id)
      continue
    }
    if (
      old.parentId !== entity.parentId ||
      !recordsEqual(old.value, entity.value, options.omitForComparison)
    ) {
      updated.push(id)
    }
  }
  for (const id of before.keys()) {
    if (!after.has(id)) deleted.push(id)
  }

  appendSummary(events, options.created, options.entityKind, created, options.revision)
  appendSummary(events, options.updated, options.entityKind, updated, options.revision)
  appendSummary(events, options.deleted, options.entityKind, deleted, options.revision)
}

function appendSummary(
  events: VaultCrudAuditEntry[],
  type: AuditEventType,
  entityKind: string,
  ids: string[],
  revision: number,
): void {
  if (ids.length === 0) return
  const vaultItemIds = ids.slice(0, MAX_AUDIT_ENTITY_IDS)
  events.push({
    type,
    details: {
      entityKind,
      revision,
      count: ids.length,
      vaultItemIds,
      omittedCount: Math.max(0, ids.length - vaultItemIds.length),
    },
  })
}

function indexVaultEntities(vault: unknown): VaultEntityIndexes {
  const indexes: VaultEntityIndexes = {
    folders: new Map(),
    secrets: new Map(),
    projects: new Map(),
    providers: new Map(),
    providerGroups: new Map(),
    preferences: null,
  }
  if (!isRecord(vault)) return indexes

  const pending: Array<{ value: unknown; parentId?: string }> = [{ value: vault.root }]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (!isRecord(current.value) || typeof current.value.id !== 'string') continue
    const folderId = current.value.id
    indexes.folders.set(folderId, { value: current.value, parentId: current.parentId })
    if (Array.isArray(current.value.secrets)) {
      for (const secret of current.value.secrets) {
        if (isRecord(secret) && typeof secret.id === 'string') {
          indexes.secrets.set(secret.id, { value: secret, parentId: folderId })
        }
      }
    }
    if (Array.isArray(current.value.children)) {
      for (const child of current.value.children) pending.push({ value: child, parentId: folderId })
    }
  }

  indexTopLevel(vault.envProjects, indexes.projects)
  indexTopLevel(vault.providers, indexes.providers)
  indexTopLevel(vault.providerGroups, indexes.providerGroups)
  indexes.preferences = isRecord(vault.preferences) ? vault.preferences : null
  return indexes
}

function indexTopLevel(value: unknown, target: Map<string, IndexedEntity>): void {
  if (!Array.isArray(value)) return
  for (const entity of value) {
    if (isRecord(entity) && typeof entity.id === 'string') target.set(entity.id, { value: entity })
  }
}

function recordsEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
  omit: Set<string> = new Set(),
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left).filter(key => !omit.has(key)).sort()
  const rightKeys = Object.keys(right).filter(key => !omit.has(key)).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]
    if (key !== rightKeys[index] || !valuesEqual(left[key], right[key])) return false
  }
  return true
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!valuesEqual(left[index], right[index])) return false
    }
    return true
  }
  if (isRecord(left) || isRecord(right)) {
    return isRecord(left) && isRecord(right) && recordsEqual(left, right)
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
