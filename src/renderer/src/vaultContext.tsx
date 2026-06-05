import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react'
import type {
  EnvProject,
  Provider,
  ProviderGroup,
  VaultFolder,
  VaultPreferences,
  VaultRoot,
  VaultSecret,
  VaultTreeItemRef,
} from './types'
import { normaliseVault } from './vaultFormat'
import { DEFAULT_LOCAL_FOLDERS } from '../../shared/defaultLocalFolders'
import { providerTypeCategory, serviceCategoryLabel } from '#service-categories'

const SECRET_REVEAL_CONFIRM_PHRASE = 'REVEAL SECRET'

// ── State ──────────────────────────────────────────────────────────────────────

type Screen = 'checking' | 'needs_setup' | 'locked' | 'unlocked'

interface State {
  screen:           Screen
  vault:            VaultRoot | null
  selectedFolderId: string | null
  selectedSecretId: string | null
  error:            string | null
  saving:           boolean
  justCompletedSetup: boolean
}

type Action =
  | { type: 'SET_SCREEN';    screen: Screen }
  | { type: 'UNLOCK';        vault: VaultRoot; justCompletedSetup?: boolean }
  | { type: 'LOCK' }
  | { type: 'SELECT_FOLDER'; id: string | null }
  | { type: 'SELECT_SECRET'; id: string | null }
  | { type: 'UPDATE_VAULT';  vault: VaultRoot }
  | { type: 'TRACK_USAGE'; secretId: string; usedAt: string }
  | { type: 'SET_REVISION'; revision: number }
  | { type: 'SET_ERROR';     error: string | null }
  | { type: 'SET_SAVING';    saving: boolean }

type SecretDraft = Omit<VaultSecret, 'id' | 'createdAt' | 'updatedAt'>
export type VaultTreeDropPosition = 'inside' | 'before' | 'after'
export type VaultFolderSortKey = 'title' | 'createdAt' | 'updatedAt' | 'usageCount' | 'lastUsedAt'
export type VaultFolderSortDirection = 'asc' | 'desc'

export interface VaultFolderSortOptions {
  key: VaultFolderSortKey
  direction: VaultFolderSortDirection
}

export interface ImportedFolderTreeResult {
  folderId: string
  firstSecretId: string | null
  secretCount: number
}

export interface RevealedSecretField {
  key: string
  value: string
  sensitive: boolean
}

export interface VaultTreeMoveTarget {
  folderId: string
  position: VaultTreeDropPosition
  target?: VaultTreeItemRef
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'SET_SCREEN':    return { ...s, screen: a.screen, error: null }
    case 'UNLOCK':        return { ...s, screen: 'unlocked', vault: a.vault, selectedFolderId: a.vault.root.id, error: null, justCompletedSetup: a.justCompletedSetup === true }
    case 'LOCK':          return { ...s, screen: 'locked', vault: null, selectedFolderId: null, selectedSecretId: null, justCompletedSetup: false }
    case 'SELECT_FOLDER': return { ...s, selectedFolderId: a.id, selectedSecretId: null }
    case 'SELECT_SECRET': return { ...s, selectedSecretId: a.id }
    case 'UPDATE_VAULT':  return { ...s, vault: a.vault }
    case 'SET_REVISION': return s.vault ? { ...s, vault: { ...s.vault, revision: a.revision } } : s
    case 'TRACK_USAGE': {
      if (!s.vault) return s
      const result = findSecret(s.vault.root, a.secretId)
      if (!result) return s
      const updated: VaultSecret = {
        ...result.secret,
        lastUsedAt: a.usedAt,
        usageCount: (result.secret.usageCount ?? 0) + 1,
        updatedAt: a.usedAt,
      }
      return {
        ...s,
        vault: {
          ...s.vault,
          root: mapFolder(s.vault.root, result.folderId, folder => ({
            ...folder,
            secrets: folder.secrets.map(secret => secret.id === a.secretId ? updated : secret),
          })),
        },
      }
    }
    case 'SET_ERROR':     return { ...s, error: a.error }
    case 'SET_SAVING':    return { ...s, saving: a.saving }
  }
}

// ── Tree helpers ───────────────────────────────────────────────────────────────

export function flatSecrets(
  node: VaultFolder,
  path: string[] = [],
): { secret: VaultSecret; folderId: string; folderPath: string }[] {
  const crumb = [...path, node.name]
  return [
    ...node.secrets.map(s => ({ secret: s, folderId: node.id, folderPath: crumb.join(' › ') })),
    ...node.children.flatMap(c => flatSecrets(c, crumb)),
  ]
}

export function findFolder(node: VaultFolder, id: string): VaultFolder | null {
  if (node.id === id) return node
  for (const c of node.children) { const f = findFolder(c, id); if (f) return f }
  return null
}

export function findSecret(node: VaultFolder, id: string): { secret: VaultSecret; folderId: string } | null {
  for (const s of node.secrets) { if (s.id === id) return { secret: s, folderId: node.id } }
  for (const c of node.children) { const f = findSecret(c, id); if (f) return f }
  return null
}

export function orderedFolderItems(folder: VaultFolder): VaultTreeItemRef[] {
  const children = new Set(folder.children.map(child => child.id))
  const secrets = new Set(folder.secrets.map(secret => secret.id))
  const seen = new Set<string>()
  const items: VaultTreeItemRef[] = []

  for (const item of folder.itemOrder ?? []) {
    if (item.kind !== 'folder' && item.kind !== 'secret') continue
    const exists = item.kind === 'folder' ? children.has(item.id) : secrets.has(item.id)
    const key = `${item.kind}:${item.id}`
    if (!exists || seen.has(key)) continue
    seen.add(key)
    items.push({ kind: item.kind, id: item.id })
  }

  for (const secret of folder.secrets) {
    const key = `secret:${secret.id}`
    if (!seen.has(key)) {
      seen.add(key)
      items.push({ kind: 'secret', id: secret.id })
    }
  }
  for (const child of folder.children) {
    const key = `folder:${child.id}`
    if (!seen.has(key)) {
      seen.add(key)
      items.push({ kind: 'folder', id: child.id })
    }
  }

  return items
}

function prepareUnlockedVault(raw: unknown): { vault: VaultRoot; changed: boolean } {
  return ensureDefaultLocalFolders(normaliseVault(raw))
}

function ensureDefaultLocalFolders(vault: VaultRoot): { vault: VaultRoot; changed: boolean } {
  if (vault.preferences?.localDefaultFoldersCreated) return { vault, changed: false }

  const existingNames = new Set(vault.root.children.map(folder => folder.name.trim().toLowerCase()))
  const knownIds = collectFolderIds(vault.root)
  const missingFolders = DEFAULT_LOCAL_FOLDERS
    .filter(folder => !existingNames.has(folder.name.toLowerCase()))
    .map(folder => {
      const id = uniqueDefaultFolderId(vault.root.id, folder.slug, knownIds)
      knownIds.add(id)
      return {
        id,
        name: folder.name,
        children: [],
        secrets: [],
        itemOrder: [],
      }
    })

  const preferences: VaultPreferences = {
    ...(vault.preferences ?? {}),
    localDefaultFoldersCreated: true,
  }

  if (missingFolders.length === 0) {
    return { vault: { ...vault, preferences }, changed: true }
  }

  const root = {
    ...vault.root,
    children: [...vault.root.children, ...missingFolders],
    itemOrder: [
      ...orderedFolderItems(vault.root),
      ...missingFolders.map(folder => ({ kind: 'folder' as const, id: folder.id })),
    ],
  }

  return { vault: { ...vault, root, preferences }, changed: true }
}

function collectFolderIds(root: VaultFolder, ids = new Set<string>()): Set<string> {
  ids.add(root.id)
  for (const child of root.children) collectFolderIds(child, ids)
  return ids
}

function uniqueDefaultFolderId(rootId: string, slug: string, knownIds: Set<string>): string {
  const base = `${rootId}-${slug}`
  let id = base
  let suffix = 2
  while (knownIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

// Find all secrets linked to a specific provider.
export function secretsForProvider(
  root: VaultFolder, providerId: string,
): { secret: VaultSecret; folderId: string; folderPath: string }[] {
  return flatSecrets(root).filter(s => s.secret.providerLink?.providerId === providerId)
}

// Find all env-projects that reference any field of a specific secret.
export function projectsUsingSecret(
  projects: { id: string; name: string; entries: { secretId: string }[] }[],
  secretId: string,
): { id: string; name: string }[] {
  return projects
    .filter(p => p.entries.some(e => e.secretId === secretId))
    .map(({ id, name }) => ({ id, name }))
}

function mapFolder(root: VaultFolder, id: string, fn: (f: VaultFolder) => VaultFolder): VaultFolder {
  if (root.id === id) return fn(root)
  return { ...root, children: root.children.map(c => mapFolder(c, id, fn)) }
}

function removeFolder(root: VaultFolder, id: string): VaultFolder {
  return {
    ...root,
    children: root.children.filter(c => c.id !== id).map(c => removeFolder(c, id)),
    itemOrder: orderedFolderItems(root).filter(item => !(item.kind === 'folder' && item.id === id)),
  }
}

function removeSecretFromFolder(root: VaultFolder, folderId: string, secretId: string): VaultFolder {
  return mapFolder(root, folderId, folder => ({
    ...folder,
    secrets: folder.secrets.filter(secret => secret.id !== secretId),
    itemOrder: orderedFolderItems(folder).filter(item => !(item.kind === 'secret' && item.id === secretId)),
  }))
}

function findFolderParent(node: VaultFolder, id: string): { folder: VaultFolder; parentId: string } | null {
  for (const child of node.children) {
    if (child.id === id) return { folder: child, parentId: node.id }
    const nested = findFolderParent(child, id)
    if (nested) return nested
  }
  return null
}

function findSecretLocation(node: VaultFolder, id: string): { secret: VaultSecret; folderId: string } | null {
  for (const secret of node.secrets) {
    if (secret.id === id) return { secret, folderId: node.id }
  }
  for (const child of node.children) {
    const nested = findSecretLocation(child, id)
    if (nested) return nested
  }
  return null
}

function folderContainsFolder(folder: VaultFolder, id: string): boolean {
  return folder.children.some(child => child.id === id || folderContainsFolder(child, id))
}

function insertTreeItem(
  root: VaultFolder,
  folderId: string,
  item: { kind: 'folder'; value: VaultFolder } | { kind: 'secret'; value: VaultSecret },
  target: VaultTreeMoveTarget,
): VaultFolder {
  return mapFolder(root, folderId, folder => {
    const nextRef: VaultTreeItemRef = {
      kind: item.kind,
      id: item.kind === 'folder' ? item.value.id : item.value.id,
    }
    const currentOrder = orderedFolderItems(folder).filter(ref => !(ref.kind === nextRef.kind && ref.id === nextRef.id))
    let insertAt = currentOrder.length

    if (target.position !== 'inside' && target.target) {
      const targetIndex = currentOrder.findIndex(ref => ref.kind === target.target!.kind && ref.id === target.target!.id)
      if (targetIndex >= 0) insertAt = target.position === 'before' ? targetIndex : targetIndex + 1
    }

    const itemOrder = [
      ...currentOrder.slice(0, insertAt),
      nextRef,
      ...currentOrder.slice(insertAt),
    ]

    return item.kind === 'folder'
      ? { ...folder, children: [...folder.children, item.value], itemOrder }
      : { ...folder, secrets: [...folder.secrets, item.value], itemOrder }
  })
}

function sortFolderTreeItems(root: VaultFolder, folderId: string, options: VaultFolderSortOptions): VaultFolder {
  return mapFolder(root, folderId, folder => ({
    ...folder,
    itemOrder: sortFolderItemRefs(folder, options),
  }))
}

function sortFolderItemRefs(folder: VaultFolder, options: VaultFolderSortOptions): VaultTreeItemRef[] {
  const refs = orderedFolderItems(folder)
  const direction = options.direction === 'asc' ? 1 : -1

  return [...refs].sort((a, b) => {
    const aMeta = folderSortMeta(folder, a)
    const bMeta = folderSortMeta(folder, b)
    const valueDelta = compareSortValue(aMeta[options.key], bMeta[options.key])
    if (valueDelta !== 0) return valueDelta * direction
    const titleDelta = aMeta.title.localeCompare(bMeta.title)
    if (titleDelta !== 0) return titleDelta
    return a.kind.localeCompare(b.kind)
  })
}

function folderSortMeta(folder: VaultFolder, ref: VaultTreeItemRef): {
  title: string
  createdAt: number
  updatedAt: number
  usageCount: number
  lastUsedAt: number
} {
  if (ref.kind === 'secret') {
    const secret = folder.secrets.find(item => item.id === ref.id)
    if (!secret) return emptySortMeta()
    return {
      title: secret.name,
      createdAt: timestamp(secret.createdAt),
      updatedAt: timestamp(secret.updatedAt),
      usageCount: secret.usageCount ?? 0,
      lastUsedAt: timestamp(secret.lastUsedAt),
    }
  }

  const child = folder.children.find(item => item.id === ref.id)
  if (!child) return emptySortMeta()
  return folderAggregateSortMeta(child)
}

function folderAggregateSortMeta(folder: VaultFolder): ReturnType<typeof folderSortMeta> {
  const childMetas = [
    ...folder.secrets.map(secret => ({
      title: secret.name,
      createdAt: timestamp(secret.createdAt),
      updatedAt: timestamp(secret.updatedAt),
      usageCount: secret.usageCount ?? 0,
      lastUsedAt: timestamp(secret.lastUsedAt),
    })),
    ...folder.children.map(folderAggregateSortMeta),
  ]
  return {
    title: folder.name,
    createdAt: minPositive(childMetas.map(item => item.createdAt)),
    updatedAt: Math.max(0, ...childMetas.map(item => item.updatedAt)),
    usageCount: childMetas.reduce((sum, item) => sum + item.usageCount, 0),
    lastUsedAt: Math.max(0, ...childMetas.map(item => item.lastUsedAt)),
  }
}

function emptySortMeta(): ReturnType<typeof folderSortMeta> {
  return { title: '', createdAt: 0, updatedAt: 0, usageCount: 0, lastUsedAt: 0 }
}

function timestamp(value?: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function minPositive(values: number[]): number {
  const positive = values.filter(value => value > 0)
  return positive.length > 0 ? Math.min(...positive) : 0
}

function compareSortValue(a: string | number, b: string | number): number {
  if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b))
  return a - b
}

function moveVaultTreeItem(
  root: VaultFolder,
  item: VaultTreeItemRef,
  target: VaultTreeMoveTarget,
): { root: VaultFolder; selectedFolderId?: string; selectedSecretId?: string } | null {
  if (target.position !== 'inside' && target.target?.kind === item.kind && target.target.id === item.id) {
    return null
  }

  if (item.kind === 'folder') {
    if (item.id === root.id || target.folderId === item.id) return null
    const source = findFolderParent(root, item.id)
    if (!source) return null
    if (folderContainsFolder(source.folder, target.folderId)) return null

    const detachedRoot = removeFolder(root, item.id)
    if (!findFolder(detachedRoot, target.folderId)) return null
    return {
      root: insertTreeItem(detachedRoot, target.folderId, { kind: 'folder', value: source.folder }, target),
      selectedFolderId: item.id,
    }
  }

  const source = findSecretLocation(root, item.id)
  if (!source) return null
  const detachedRoot = removeSecretFromFolder(root, source.folderId, item.id)
  if (!findFolder(detachedRoot, target.folderId)) return null
  return {
    root: insertTreeItem(detachedRoot, target.folderId, { kind: 'secret', value: source.secret }, target),
    selectedFolderId: target.folderId,
    selectedSecretId: item.id,
  }
}

function insertProvider(providers: Provider[], provider: Provider, targetGroupId: string | null, targetProviderId?: string, position?: 'before' | 'after'): Provider[] {
  const nextProvider = { ...provider, groupId: targetGroupId ?? undefined }
  const remaining = providers.filter(p => p.id !== provider.id)

  if (targetProviderId && position) {
    const index = remaining.findIndex(p => p.id === targetProviderId)
    if (index >= 0) {
      const insertAt = position === 'before' ? index : index + 1
      return [...remaining.slice(0, insertAt), nextProvider, ...remaining.slice(insertAt)]
    }
  }

  const lastInGroup = remaining.reduce((last, p, index) => ((p.groupId ?? null) === targetGroupId ? index : last), -1)
  const insertAt = lastInGroup >= 0 ? lastInGroup + 1 : remaining.length
  return [...remaining.slice(0, insertAt), nextProvider, ...remaining.slice(insertAt)]
}

interface ClonedImportedFolder {
  oldId: string
  folder: VaultFolder
  firstSecretId: string | null
  secretCount: number
}

const IMPORTED_SECRET_TYPES = new Set<VaultSecret['type']>([
  'password',
  'apiKey',
  'sshKey',
  'secureNote',
  'custom',
  'image',
])

function cloneImportedFolderTree(
  folder: VaultFolder,
  selectedSecretIds: Set<string> | undefined,
  now: string,
): ClonedImportedFolder | null {
  const secretPairs = folder.secrets
    .filter(secret => !selectedSecretIds || selectedSecretIds.has(secret.id))
    .map(secret => ({
      oldId: secret.id,
      secret: cloneImportedSecret(secret, now),
    }))

  const childPairs = folder.children
    .map(child => cloneImportedFolderTree(child, selectedSecretIds, now))
    .filter((child): child is ClonedImportedFolder => Boolean(child))

  if (selectedSecretIds && secretPairs.length === 0 && childPairs.length === 0) return null

  const secretIdByOld = new Map(secretPairs.map(pair => [pair.oldId, pair.secret.id]))
  const folderIdByOld = new Map(childPairs.map(pair => [pair.oldId, pair.folder.id]))
  const itemOrder: VaultTreeItemRef[] = []
  const seen = new Set<string>()

  for (const item of orderedFolderItems(folder)) {
    const id = item.kind === 'folder'
      ? folderIdByOld.get(item.id)
      : secretIdByOld.get(item.id)
    if (!id) continue
    const key = `${item.kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    itemOrder.push({ kind: item.kind, id })
  }

  for (const pair of secretPairs) {
    const key = `secret:${pair.secret.id}`
    if (!seen.has(key)) {
      seen.add(key)
      itemOrder.push({ kind: 'secret', id: pair.secret.id })
    }
  }
  for (const pair of childPairs) {
    const key = `folder:${pair.folder.id}`
    if (!seen.has(key)) {
      seen.add(key)
      itemOrder.push({ kind: 'folder', id: pair.folder.id })
    }
  }

  const clonedFolder: VaultFolder = {
    ...folder,
    id: crypto.randomUUID(),
    name: folder.name.trim() || 'Imported folder',
    children: childPairs.map(pair => pair.folder),
    secrets: secretPairs.map(pair => pair.secret),
    itemOrder,
  }

  return {
    oldId: folder.id,
    folder: clonedFolder,
    firstSecretId: firstSecretInFolder(clonedFolder),
    secretCount: secretPairs.length + childPairs.reduce((sum, pair) => sum + pair.secretCount, 0),
  }
}

function cloneImportedSecret(secret: VaultSecret, now: string): VaultSecret {
  const rawFields = Array.isArray((secret as { fields?: unknown }).fields)
    ? (secret as { fields: unknown[] }).fields
    : []
  const fields = rawFields
    .filter((field): field is Record<string, unknown> => Boolean(field && typeof field === 'object' && !Array.isArray(field)))
    .map(field => ({
      key: typeof field.key === 'string' && field.key.trim() ? field.key : 'Value',
      value: typeof field.value === 'string' ? field.value : '',
      sensitive: field.sensitive === true,
    }))

  const type = IMPORTED_SECRET_TYPES.has(secret.type) ? secret.type : 'custom'

  return {
    ...secret,
    id: crypto.randomUUID(),
    name: typeof secret.name === 'string' && secret.name.trim() ? secret.name : 'Imported secret',
    type,
    fields,
    notes: typeof secret.notes === 'string' ? secret.notes : '',
    createdAt: safeIsoDate(secret.createdAt, now),
    updatedAt: safeIsoDate(secret.updatedAt, now),
    description: typeof secret.description === 'string' ? secret.description : undefined,
    scope: typeof secret.scope === 'string' ? secret.scope : undefined,
    tags: Array.isArray(secret.tags) ? secret.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    expiresAt: typeof secret.expiresAt === 'string' ? secret.expiresAt : undefined,
    usedIn: Array.isArray(secret.usedIn) ? secret.usedIn.filter((item): item is string => typeof item === 'string') : undefined,
    lastUsedAt: typeof secret.lastUsedAt === 'string' ? secret.lastUsedAt : undefined,
    usageCount: typeof secret.usageCount === 'number' && Number.isFinite(secret.usageCount) ? secret.usageCount : undefined,
    providerLink: secret.providerLink && typeof secret.providerLink === 'object' ? secret.providerLink : undefined,
    agentAvailable: secret.agentAvailable === true ? true : undefined,
  }
}

function safeIsoDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback
}

function firstSecretInFolder(folder: VaultFolder): string | null {
  for (const item of orderedFolderItems(folder)) {
    if (item.kind === 'secret' && folder.secrets.some(secret => secret.id === item.id)) return item.id
    if (item.kind === 'folder') {
      const child = folder.children.find(candidate => candidate.id === item.id)
      if (!child) continue
      const found = firstSecretInFolder(child)
      if (found) return found
    }
  }
  return null
}

function duplicateFolderName(parent: VaultFolder, originalName: string): string {
  const base = `${originalName.trim() || 'Folder'} copy`
  const names = new Set(parent.children.map(folder => folder.name.trim().toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  let index = 2
  while (names.has(`${base} ${index}`.toLowerCase())) index += 1
  return `${base} ${index}`
}

function insertFolderAfter(parent: VaultFolder, originalId: string, folder: VaultFolder): VaultFolder {
  const currentOrder = orderedFolderItems(parent)
  const originalIndex = currentOrder.findIndex(item => item.kind === 'folder' && item.id === originalId)
  const insertAt = originalIndex >= 0 ? originalIndex + 1 : currentOrder.length
  const itemOrder = [
    ...currentOrder.slice(0, insertAt),
    { kind: 'folder' as const, id: folder.id },
    ...currentOrder.slice(insertAt),
  ]
  return {
    ...parent,
    children: [...parent.children, folder],
    itemOrder,
  }
}

// ── Context ────────────────────────────────────────────────────────────────────

interface Ctx {
  state:        State

  // Auth
  setup:           (password: string) => Promise<void>
  unlockTouchID:   () => Promise<{ notFound?: boolean; cancelled?: boolean; authFailed?: boolean; touchIdInvalid?: boolean }>
  unlockPassword:  (password: string) => Promise<{ success?: boolean; wrongPassword?: boolean; touchIdRestored?: boolean }>
  lock:            () => Promise<void>
  signOut:         () => Promise<void>

  // Navigation
  selectFolder: (id: string | null) => void
  selectSecret: (id: string | null) => void

  // Folders
  addFolder:    (parentId: string, name: string) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  duplicateFolder: (id: string) => Promise<void>
  moveTreeItem: (item: VaultTreeItemRef, target: VaultTreeMoveTarget) => Promise<void>
  sortFolderItems: (folderId: string, options: VaultFolderSortOptions) => Promise<void>
  importFolderTree: (parentId: string, folder: VaultFolder, selectedSecretIds?: Set<string>) => Promise<ImportedFolderTreeResult>

  // Secrets
  addSecret:    (folderId: string, s: SecretDraft) => Promise<void>
  addSecrets:   (folderId: string, secrets: SecretDraft[]) => Promise<VaultSecret[]>
  updateSecret: (folderId: string, s: VaultSecret) => Promise<void>
  deleteSecret: (folderId: string, secretId: string) => Promise<void>
  trackUsage:   (folderId: string, secretId: string) => void
  copySecretField: (secretId: string, fieldKey: string, options?: { clearAfterMs?: number }) => Promise<boolean>
  copySecretImageField: (secretId: string, fieldKey: string) => Promise<boolean>
  revealSecretField: (secretId: string, fieldKey: string, options?: { pin?: string }) => Promise<string | null>
  revealSecretImageField: (secretId: string, fieldKey: string, options?: { pin?: string }) => Promise<string | null>
  revealSecretFields: (secretId: string, options?: { pin?: string }) => Promise<RevealedSecretField[] | null>

  // Reveal PIN
  setRevealPin: (pin: string, masterPassword: string) => Promise<{ success?: boolean; wrongPassword?: boolean; error?: string }>
  clearRevealPin: (masterPassword: string) => Promise<{ success?: boolean; wrongPassword?: boolean; error?: string }>

  // Providers
  addProvider:    (p: Omit<Provider, 'id'>) => Promise<void>
  updateProvider: (p: Provider) => Promise<void>
  updateProviderAndSecret: (p: Provider, folderId: string, s: VaultSecret) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  addProviderGroup:    (name: string) => Promise<void>
  renameProviderGroup: (id: string, name: string) => Promise<void>
  deleteProviderGroup: (id: string) => Promise<void>
  moveProvider: (providerId: string, groupId: string | null, targetProviderId?: string, position?: 'before' | 'after') => Promise<void>

  // Env projects
  addEnvProject:    (p: Omit<EnvProject, 'id'>) => Promise<EnvProject | null>
  updateEnvProject: (p: EnvProject) => Promise<void>
  updateEnvProjects: (projects: EnvProject[]) => Promise<void>
  deleteEnvProject: (id: string) => Promise<void>

  // Preferences
  setPreferences:   (patch: Partial<VaultPreferences>) => Promise<void>
}

const VaultCtx = createContext<Ctx | null>(null)

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    screen: 'checking', vault: null,
    selectedFolderId: null, selectedSecretId: null,
    error: null, saving: false,
    justCompletedSetup: false,
  })

  useEffect(() => {
    window.vault.status().then(({ needsSetup }) =>
      dispatch({ type: 'SET_SCREEN', screen: needsSetup ? 'needs_setup' : 'locked' })
    )
  }, [])

  // ── Persistence ──────────────────────────────────────────────────────────────

  const persist = useCallback(async (vault: VaultRoot) => {
    dispatch({ type: 'SET_SAVING', saving: true })
    try {
      const res = await window.vault.save(JSON.stringify(vault))
      if (!res.success) throw new Error(res.error)
      dispatch({
        type: 'UPDATE_VAULT',
        vault: res.data
          ? normaliseVault(res.data)
          : { ...vault, revision: res.revision ?? vault.revision },
      })
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false })
    }
  }, [])

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const setup = useCallback(async (password: string) => {
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.setup(password)
    if (res.success && res.data) {
      const prepared = prepareUnlockedVault(res.data)
      dispatch({ type: 'UNLOCK', vault: prepared.vault, justCompletedSetup: true })
      if (prepared.changed) void persist(prepared.vault).catch(err => console.error('[vault] Failed to save default folders:', err))
    } else dispatch({ type: 'SET_ERROR', error: res.error ?? 'Setup failed' })
  }, [persist])

  const unlockTouchID = useCallback(async () => {
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.touchID()
    if (res.success && res.data) {
      const prepared = prepareUnlockedVault(res.data)
      dispatch({ type: 'UNLOCK', vault: prepared.vault })
      if (prepared.changed) void persist(prepared.vault).catch(err => console.error('[vault] Failed to save default folders:', err))
    } else if (!res.cancelled) dispatch({ type: 'SET_ERROR', error: res.error ?? 'Touch ID failed' })
    return {
      notFound: res.notFound,
      cancelled: res.cancelled,
      authFailed: res.authFailed,
      touchIdInvalid: res.touchIdInvalid,
    }
  }, [persist])

  const unlockPassword = useCallback(async (password: string) => {
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.password(password)
    if (res.success && res.data) {
      const prepared = prepareUnlockedVault(res.data)
      dispatch({ type: 'UNLOCK', vault: prepared.vault })
      if (prepared.changed) void persist(prepared.vault).catch(err => console.error('[vault] Failed to save default folders:', err))
    } else dispatch({ type: 'SET_ERROR', error: res.error ?? 'Unlock failed' })
    return { success: res.success, wrongPassword: res.wrongPassword, touchIdRestored: res.touchIdRestored }
  }, [persist])

  const lock = useCallback(async () => {
    await window.vault.lock()
    dispatch({ type: 'LOCK' })
  }, [])

  const signOut = useCallback(async () => {
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.signOut()
    if (res.success) {
      dispatch({ type: 'LOCK' })
    } else {
      const error = res.error ?? 'Could not sign out'
      dispatch({ type: 'SET_ERROR', error })
      throw new Error(error)
    }
  }, [])

  // ── Navigation ───────────────────────────────────────────────────────────────

  const selectFolder = useCallback((id: string | null) => dispatch({ type: 'SELECT_FOLDER', id }), [])
  const selectSecret = useCallback((id: string | null) => dispatch({ type: 'SELECT_SECRET', id }), [])

  // ── Folders ──────────────────────────────────────────────────────────────────

  const addFolder = useCallback(async (parentId: string, name: string) => {
    if (!state.vault) return
    const folder: VaultFolder = { id: crypto.randomUUID(), name, children: [], secrets: [], itemOrder: [] }
    await persist({
      ...state.vault,
      root: mapFolder(state.vault.root, parentId, f => ({
        ...f,
        children: [...f.children, folder],
        itemOrder: [...orderedFolderItems(f), { kind: 'folder', id: folder.id }],
      })),
    })
  }, [state.vault, persist])

  const renameFolder = useCallback(async (id: string, name: string) => {
    if (!state.vault) return
    await persist({ ...state.vault, root: mapFolder(state.vault.root, id, f => ({ ...f, name })) })
  }, [state.vault, persist])

  const deleteFolder = useCallback(async (id: string) => {
    if (!state.vault) return
    await persist({ ...state.vault, root: removeFolder(state.vault.root, id) })
    if (state.selectedFolderId === id) dispatch({ type: 'SELECT_FOLDER', id: state.vault.root.id })
  }, [state.vault, state.selectedFolderId, persist])

  const duplicateFolder = useCallback(async (id: string) => {
    if (!state.vault || id === state.vault.root.id) return
    const source = findFolderParent(state.vault.root, id)
    if (!source) return
    const cloned = cloneImportedFolderTree(source.folder, undefined, new Date().toISOString())
    if (!cloned) return
    const copy: VaultFolder = {
      ...cloned.folder,
      name: duplicateFolderName(findFolder(state.vault.root, source.parentId) ?? state.vault.root, source.folder.name),
    }
    await persist({
      ...state.vault,
      root: mapFolder(state.vault.root, source.parentId, parent => insertFolderAfter(parent, id, copy)),
    })
    dispatch({ type: 'SELECT_FOLDER', id: copy.id })
    if (cloned.firstSecretId) dispatch({ type: 'SELECT_SECRET', id: cloned.firstSecretId })
  }, [state.vault, persist])

  const moveTreeItem = useCallback(async (item: VaultTreeItemRef, target: VaultTreeMoveTarget) => {
    if (!state.vault) return
    const moved = moveVaultTreeItem(state.vault.root, item, target)
    if (!moved) return
    await persist({ ...state.vault, root: moved.root })
    if (moved.selectedFolderId) dispatch({ type: 'SELECT_FOLDER', id: moved.selectedFolderId })
    if (moved.selectedSecretId) dispatch({ type: 'SELECT_SECRET', id: moved.selectedSecretId })
  }, [state.vault, persist])

  const sortFolderItems = useCallback(async (folderId: string, options: VaultFolderSortOptions) => {
    if (!state.vault) return
    await persist({ ...state.vault, root: sortFolderTreeItems(state.vault.root, folderId, options) })
  }, [state.vault, persist])

  const importFolderTree = useCallback(async (
    parentId: string,
    folder: VaultFolder,
    selectedSecretIds?: Set<string>,
  ): Promise<ImportedFolderTreeResult> => {
    if (!state.vault) return { folderId: parentId, firstSecretId: null, secretCount: 0 }
    const cloned = cloneImportedFolderTree(folder, selectedSecretIds, new Date().toISOString())
    if (!cloned || cloned.secretCount === 0) {
      return { folderId: parentId, firstSecretId: null, secretCount: 0 }
    }
    await persist({
      ...state.vault,
      root: mapFolder(state.vault.root, parentId, f => ({
        ...f,
        children: [...f.children, cloned.folder],
        itemOrder: [...orderedFolderItems(f), { kind: 'folder', id: cloned.folder.id }],
      })),
    })
    return {
      folderId: cloned.folder.id,
      firstSecretId: cloned.firstSecretId,
      secretCount: cloned.secretCount,
    }
  }, [state.vault, persist])

  // ── Secrets ──────────────────────────────────────────────────────────────────

  const addSecrets = useCallback(async (folderId: string, secrets: SecretDraft[]) => {
    if (!state.vault || secrets.length === 0) return []
    const now = new Date().toISOString()
    const created: VaultSecret[] = secrets.map(s => ({
      ...s,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))
    await persist({
      ...state.vault,
      root: mapFolder(state.vault.root, folderId, f => ({
        ...f,
        secrets: [...f.secrets, ...created],
        itemOrder: [
          ...orderedFolderItems(f),
          ...created.map(secret => ({ kind: 'secret' as const, id: secret.id })),
        ],
      })),
    })
    return created
  }, [state.vault, persist])

  const addSecret = useCallback(async (folderId: string, data: SecretDraft) => {
    await addSecrets(folderId, [data])
  }, [addSecrets])

  const updateSecret = useCallback(async (folderId: string, secret: VaultSecret) => {
    if (!state.vault) return
    const updated = { ...secret, updatedAt: new Date().toISOString() }
    await persist({ ...state.vault, root: mapFolder(state.vault.root, folderId, f => ({ ...f, secrets: f.secrets.map(s => s.id === secret.id ? updated : s) })) })
  }, [state.vault, persist])

  const deleteSecret = useCallback(async (folderId: string, secretId: string) => {
    if (!state.vault) return
    await persist({ ...state.vault, root: removeSecretFromFolder(state.vault.root, folderId, secretId) })
    if (state.selectedSecretId === secretId) dispatch({ type: 'SELECT_SECRET', id: null })
  }, [state.vault, state.selectedSecretId, persist])

  // Fire-and-forget main-process mutation; doesn't block the copy UX.
  const trackUsage = useCallback((folderId: string, secretId: string) => {
    if (!state.vault) return
    void folderId
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt: new Date().toISOString() })
    window.vault.trackUsage({ secretId }).then(res => {
      if (res.success && typeof res.revision === 'number') {
        dispatch({ type: 'SET_REVISION', revision: res.revision })
      } else if (!res.success) {
        console.error('[vault] Failed to track usage:', res.error)
      }
    })
  }, [state.vault])

  const copySecretField = useCallback(async (
    secretId: string,
    fieldKey: string,
    options?: { clearAfterMs?: number },
  ) => {
    if (!state.vault) return false
    const usedAt = new Date().toISOString()
    const res = await window.vault.copySecretField({
      secretId,
      fieldKey,
      clearAfterMs: options?.clearAfterMs,
    })
    if (!res.success) {
      console.error('[vault] Failed to copy secret field:', res.error)
      return false
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return true
  }, [state.vault])

  const copySecretImageField = useCallback(async (secretId: string, fieldKey: string) => {
    if (!state.vault) return false
    const usedAt = new Date().toISOString()
    const res = await window.vault.copySecretImageField({ secretId, fieldKey })
    if (!res.success) {
      console.error('[vault] Failed to copy secret image field:', res.error)
      return false
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return true
  }, [state.vault])

  const revealSecretField = useCallback(async (secretId: string, fieldKey: string, options?: { pin?: string }) => {
    if (!state.vault) return null
    const usedAt = new Date().toISOString()
    const confirmationPhrase = options?.pin ? undefined : secretRevealConfirmationPhrase()
    if (confirmationPhrase === null) return null
    const res = await window.vault.revealSecretField({ secretId, fieldKey, confirmationPhrase, pin: options?.pin })
    if (!res.success || typeof res.value !== 'string') {
      console.error('[vault] Failed to reveal secret field:', res.error)
      return null
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return res.value
  }, [state.vault])

  const revealSecretImageField = useCallback(async (secretId: string, fieldKey: string, options?: { pin?: string }) => {
    if (!state.vault) return null
    const usedAt = new Date().toISOString()
    const confirmationPhrase = options?.pin ? undefined : secretRevealConfirmationPhrase()
    if (confirmationPhrase === null) return null
    const res = await window.vault.revealSecretImageField({ secretId, fieldKey, confirmationPhrase, pin: options?.pin })
    if (!res.success || typeof res.value !== 'string') {
      console.error('[vault] Failed to reveal secret image field:', res.error)
      return null
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return res.value
  }, [state.vault])

  const revealSecretFields = useCallback(async (secretId: string, options?: { pin?: string }) => {
    if (!state.vault) return null
    const usedAt = new Date().toISOString()
    const confirmationPhrase = options?.pin ? undefined : secretRevealConfirmationPhrase()
    if (confirmationPhrase === null) return null
    const res = await window.vault.revealSecretFields({ secretId, confirmationPhrase, pin: options?.pin })
    if (!res.success || !Array.isArray(res.fields)) {
      console.error('[vault] Failed to reveal secret fields:', res.error)
      return null
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return res.fields
  }, [state.vault])

  const setRevealPin = useCallback(async (pin: string, masterPassword: string) => {
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.setRevealPin({ pin, masterPassword })
    if (res.success && res.data) {
      dispatch({ type: 'UPDATE_VAULT', vault: normaliseVault(res.data) })
    } else if (!res.success) {
      dispatch({ type: 'SET_ERROR', error: res.error ?? 'Could not set reveal PIN' })
    }
    return { success: res.success, wrongPassword: res.wrongPassword, error: res.error }
  }, [])

  const clearRevealPin = useCallback(async (masterPassword: string) => {
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.clearRevealPin({ masterPassword })
    if (res.success && res.data) {
      dispatch({ type: 'UPDATE_VAULT', vault: normaliseVault(res.data) })
    } else if (!res.success) {
      dispatch({ type: 'SET_ERROR', error: res.error ?? 'Could not clear reveal PIN' })
    }
    return { success: res.success, wrongPassword: res.wrongPassword, error: res.error }
  }, [])

  // ── Providers ────────────────────────────────────────────────────────────────

  const addProvider = useCallback(async (p: Omit<Provider, 'id'>) => {
    if (!state.vault) return
    let providerGroups = state.vault.providerGroups ?? []
    let groupId = p.groupId ?? null

    // File the service into its catalog-category folder, reusing a matching
    // folder when one already exists (by category, or by a same-named manual
    // folder) and otherwise creating one that mirrors the catalog icon + name.
    const category = groupId === null ? providerTypeCategory(p.type) : null
    if (category) {
      const label = serviceCategoryLabel(category)
      const existing =
        providerGroups.find(group => group.categoryId === category) ??
        providerGroups.find(group => group.name.toLowerCase() === label.toLowerCase())
      if (existing) {
        groupId = existing.id
        if (existing.categoryId !== category) {
          providerGroups = providerGroups.map(group =>
            group.id === existing.id ? { ...group, categoryId: category } : group,
          )
        }
      } else {
        const group: ProviderGroup = { id: crypto.randomUUID(), name: label, categoryId: category }
        providerGroups = [...providerGroups, group]
        groupId = group.id
      }
    }

    const provider: Provider = { ...p, id: crypto.randomUUID(), groupId: groupId ?? undefined }
    await persist({
      ...state.vault,
      providers: [...(state.vault.providers ?? []), provider],
      providerGroups,
    })
  }, [state.vault, persist])

  const updateProvider = useCallback(async (p: Provider) => {
    if (!state.vault) return
    await persist({ ...state.vault, providers: (state.vault.providers ?? []).map(x => x.id === p.id ? p : x) })
  }, [state.vault, persist])

  const updateProviderAndSecret = useCallback(async (p: Provider, folderId: string, secret: VaultSecret) => {
    if (!state.vault) return
    const updatedSecret = { ...secret, updatedAt: new Date().toISOString() }
    await persist({
      ...state.vault,
      providers: (state.vault.providers ?? []).map(x => x.id === p.id ? p : x),
      root: mapFolder(state.vault.root, folderId, f => ({
        ...f,
        secrets: f.secrets.map(s => s.id === secret.id ? updatedSecret : s),
      })),
    })
  }, [state.vault, persist])

  const deleteProvider = useCallback(async (id: string) => {
    if (!state.vault) return
    await persist({ ...state.vault, providers: (state.vault.providers ?? []).filter(p => p.id !== id) })
  }, [state.vault, persist])

  const addProviderGroup = useCallback(async (name: string) => {
    if (!state.vault) return
    const group: ProviderGroup = { id: crypto.randomUUID(), name }
    await persist({ ...state.vault, providerGroups: [...(state.vault.providerGroups ?? []), group] })
  }, [state.vault, persist])

  const renameProviderGroup = useCallback(async (id: string, name: string) => {
    if (!state.vault) return
    await persist({
      ...state.vault,
      providerGroups: (state.vault.providerGroups ?? []).map(group => group.id === id ? { ...group, name } : group),
    })
  }, [state.vault, persist])

  const deleteProviderGroup = useCallback(async (id: string) => {
    if (!state.vault) return
    await persist({
      ...state.vault,
      providerGroups: (state.vault.providerGroups ?? []).filter(group => group.id !== id),
      providers: (state.vault.providers ?? []).map(provider => provider.groupId === id ? { ...provider, groupId: undefined } : provider),
    })
  }, [state.vault, persist])

  const moveProvider = useCallback(async (providerId: string, groupId: string | null, targetProviderId?: string, position?: 'before' | 'after') => {
    if (!state.vault) return
    const provider = (state.vault.providers ?? []).find(p => p.id === providerId)
    if (!provider || provider.id === targetProviderId) return
    await persist({
      ...state.vault,
      providers: insertProvider(state.vault.providers ?? [], provider, groupId, targetProviderId, position),
    })
  }, [state.vault, persist])

  // ── Env projects ─────────────────────────────────────────────────────────────

  const addEnvProject = useCallback(async (p: Omit<EnvProject, 'id'>) => {
    if (!state.vault) return null
    const project: EnvProject = { ...p, id: crypto.randomUUID() }
    await persist({ ...state.vault, envProjects: [...(state.vault.envProjects ?? []), project] })
    return project
  }, [state.vault, persist])

  const updateEnvProject = useCallback(async (p: EnvProject) => {
    if (!state.vault) return
    await persist({ ...state.vault, envProjects: (state.vault.envProjects ?? []).map(x => x.id === p.id ? p : x) })
  }, [state.vault, persist])

  const updateEnvProjects = useCallback(async (projects: EnvProject[]) => {
    if (!state.vault) return
    const byId = new Map(projects.map(project => [project.id, project]))
    await persist({
      ...state.vault,
      envProjects: (state.vault.envProjects ?? []).map(project => byId.get(project.id) ?? project),
    })
  }, [state.vault, persist])

  const deleteEnvProject = useCallback(async (id: string) => {
    if (!state.vault) return
    await persist({ ...state.vault, envProjects: (state.vault.envProjects ?? []).filter(p => p.id !== id) })
  }, [state.vault, persist])

  // ── Preferences ──────────────────────────────────────────────────────────────

  const setPreferences = useCallback(async (patch: Partial<VaultPreferences>) => {
    if (!state.vault) return
    const next: VaultPreferences = { ...(state.vault.preferences ?? {}), ...patch }
    await persist({ ...state.vault, preferences: next })
  }, [state.vault, persist])

  return (
    <VaultCtx.Provider value={{
      state, setup, unlockTouchID, unlockPassword, lock, signOut,
      selectFolder, selectSecret,
      addFolder, renameFolder, deleteFolder, duplicateFolder, moveTreeItem, sortFolderItems, importFolderTree,
      addSecret, addSecrets, updateSecret, deleteSecret, trackUsage, copySecretField, copySecretImageField,
      revealSecretField, revealSecretImageField, revealSecretFields,
      setRevealPin, clearRevealPin,
      addProvider, updateProvider, updateProviderAndSecret, deleteProvider,
      addProviderGroup, renameProviderGroup, deleteProviderGroup, moveProvider,
      addEnvProject, updateEnvProject, updateEnvProjects, deleteEnvProject,
      setPreferences,
    }}>
      {children}
    </VaultCtx.Provider>
  )
}

export function useVault(): Ctx {
  const ctx = useContext(VaultCtx)
  if (!ctx) throw new Error('useVault must be inside VaultProvider')
  return ctx
}

function secretRevealConfirmationPhrase(): string | undefined | null {
  if (window.vault.platform === 'darwin') return undefined
  const phrase = window.prompt(`Type ${SECRET_REVEAL_CONFIRM_PHRASE} to reveal this saved value.`)
  if (phrase === null) return null
  return phrase
}
