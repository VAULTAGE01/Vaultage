import React, { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  EnvEntry,
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
import { findFolder, findSecret, flatSecrets, orderedFolderItems } from './lib/vaultTree'
import { ensureProjectEnvironments } from './lib/projectEnvironments'
import { DEFAULT_LOCAL_FOLDERS } from '../../shared/defaultLocalFolders'
import { providerTypeCategory, serviceCategoryLabel } from '#service-categories'
import type { VaultMutationCommand } from '../../shared/vaultIpcContracts'
import { toast } from 'sonner'

const SECRET_REVEAL_CONFIRM_PHRASE = 'REVEAL SECRET'

export { findFolder, findSecret, flatSecrets, orderedFolderItems } from './lib/vaultTree'

// ── State ──────────────────────────────────────────────────────────────────────

type Screen = 'checking' | 'needs_setup' | 'recovery' | 'locked' | 'unlocked'

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
  | { type: 'SET_RECOVERY'; error: string }
  | { type: 'UNLOCK';        vault: VaultRoot; justCompletedSetup?: boolean }
  | { type: 'LOCK' }
  | { type: 'SELECT_FOLDER'; id: string | null }
  | { type: 'SELECT_SECRET'; id: string | null }
  | { type: 'UPDATE_VAULT';  vault: VaultRoot }
  | { type: 'REMOTE_VAULT_CHANGED'; vault: VaultRoot; revision: number }
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

export interface ProviderMutationAuthorization {
  verificationGrant?: string
  expectedRevision: number
}

export interface ImportedFolderTreeResult {
  folderId: string
  firstSecretId: string | null
  secretCount: number
}

export interface RevealedSecretField {
  id?: string
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
    case 'SET_RECOVERY':  return { ...s, screen: 'recovery', vault: null, error: a.error }
    case 'UNLOCK':        return { ...s, screen: 'unlocked', vault: a.vault, selectedFolderId: a.vault.root.id, error: null, saving: false, justCompletedSetup: a.justCompletedSetup === true }
    case 'LOCK':          return { ...s, screen: 'locked', vault: null, selectedFolderId: null, selectedSecretId: null, saving: false, justCompletedSetup: false }
    case 'SELECT_FOLDER': return { ...s, selectedFolderId: a.id, selectedSecretId: null }
    case 'SELECT_SECRET': return { ...s, selectedSecretId: a.id }
    case 'UPDATE_VAULT':  return { ...s, vault: a.vault, ...reconcileSnapshotSelection(s, a.vault) }
    case 'REMOTE_VAULT_CHANGED': {
      if (!s.vault || a.revision <= (s.vault.revision ?? 0)) return s
      return { ...s, vault: a.vault, error: null, ...reconcileSnapshotSelection(s, a.vault) }
    }
    case 'SET_REVISION': {
      if (!s.vault || a.revision <= (s.vault.revision ?? 0)) return s
      return { ...s, vault: { ...s.vault, revision: a.revision } }
    }
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

export function reconcileSnapshotSelection(
  state: Pick<State, 'selectedFolderId' | 'selectedSecretId'>,
  vault: VaultRoot,
): Pick<State, 'selectedFolderId' | 'selectedSecretId'> {
  const selectedSecret = state.selectedSecretId
    ? findSecret(vault.root, state.selectedSecretId)
    : null
  const selectedFolderId = state.selectedFolderId && findFolder(vault.root, state.selectedFolderId)
    ? state.selectedFolderId
    : selectedSecret?.folderId ?? vault.root.id
  return {
    selectedFolderId,
    selectedSecretId: selectedSecret ? state.selectedSecretId : null,
  }
}

export class RendererVaultSessionChangedError extends Error {
  constructor() {
    super('Vault session changed; unlock and try again')
    this.name = 'RendererVaultSessionChangedError'
  }
}

/**
 * Monotonic renderer-session witness shared by authentication, queued writes,
 * and late IPC responses. A session epoch is invalidated before lock/sign-out,
 * so work authored by an earlier unlocked vault can never become current again
 * merely because the same vault is subsequently unlocked.
 */
export class RendererVaultSessionGuard {
  private epochValue = 0
  private unlockedValue = false

  get epoch(): number {
    return this.epochValue
  }

  get unlocked(): boolean {
    return this.unlockedValue
  }

  captureAuthAttempt(): number {
    return this.epochValue
  }

  isAuthAttemptCurrent(epoch: number): boolean {
    return !this.unlockedValue && epoch === this.epochValue
  }

  begin(): number {
    this.epochValue += 1
    this.unlockedValue = true
    return this.epochValue
  }

  end(): number {
    this.epochValue += 1
    this.unlockedValue = false
    return this.epochValue
  }

  isCurrent(epoch: number): boolean {
    return this.unlockedValue && epoch === this.epochValue
  }
}

/**
 * Serialises renderer mutations while checking the session both before and
 * after each async commit. The second check is what prevents an old response
 * from being observed after lock followed by a fresh unlock.
 */
export class RendererVaultMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  reset(): void {
    this.tail = Promise.resolve()
  }

  enqueue<T>(
    sessionEpoch: number,
    isCurrent: (epoch: number) => boolean,
    operation: () => Promise<T>,
  ): Promise<T> {
    const pending = this.tail.then(async () => {
      if (!isCurrent(sessionEpoch)) throw new RendererVaultSessionChangedError()
      const result = await operation()
      if (!isCurrent(sessionEpoch)) throw new RendererVaultSessionChangedError()
      return result
    })
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }
}

export function canInstallVaultSnapshot(
  current: VaultRoot | null,
  candidate: VaultRoot,
  allowEqualRevision = false,
): boolean {
  if (!current) return true
  if (current.root.id !== candidate.root.id) return false
  const currentRevision = current.revision ?? 1
  const candidateRevision = candidate.revision ?? 1
  return allowEqualRevision
    ? candidateRevision >= currentRevision
    : candidateRevision > currentRevision
}

function prepareUnlockedVault(raw: unknown): {
  vault: VaultRoot
  changed: boolean
  defaultFolders: { id: string; name: string }[]
} {
  return ensureDefaultLocalFolders(normaliseVault(raw))
}

function ensureDefaultLocalFolders(vault: VaultRoot): {
  vault: VaultRoot
  changed: boolean
  defaultFolders: { id: string; name: string }[]
} {
  if (vault.preferences?.localDefaultFoldersCreated) return { vault, changed: false, defaultFolders: [] }

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
    return { vault: { ...vault, preferences }, changed: true, defaultFolders: [] }
  }

  const root = {
    ...vault.root,
    children: [...vault.root.children, ...missingFolders],
    itemOrder: [
      ...orderedFolderItems(vault.root),
      ...missingFolders.map(folder => ({ kind: 'folder' as const, id: folder.id })),
    ],
  }

  return {
    vault: { ...vault, root, preferences },
    changed: true,
    defaultFolders: missingFolders.map(folder => ({ id: folder.id, name: folder.name })),
  }
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

function commandResultRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function commandResultString(value: unknown, key: string): string | null {
  const field = commandResultRecord(value)?.[key]
  return typeof field === 'string' && field ? field : null
}

function commandFolderImportResult(value: unknown): ImportedFolderTreeResult | null {
  const result = commandResultRecord(value)
  if (!result || typeof result.folderId !== 'string') return null
  return {
    folderId: result.folderId,
    firstSecretId: typeof result.firstSecretId === 'string' ? result.firstSecretId : null,
    secretCount: typeof result.secretCount === 'number' && Number.isInteger(result.secretCount)
      ? result.secretCount
      : 0,
  }
}

function commandMoveResult(value: unknown): {
  selectedFolderId?: string
  selectedSecretId?: string
} | null {
  const result = commandResultRecord(value)
  if (!result) return null
  const selectedFolderId = typeof result.selectedFolderId === 'string' ? result.selectedFolderId : undefined
  const selectedSecretId = typeof result.selectedSecretId === 'string' ? result.selectedSecretId : undefined
  return selectedFolderId || selectedSecretId ? { selectedFolderId, selectedSecretId } : null
}

function uniqueFieldByKey(secret: VaultSecret, fieldKey: string): VaultSecret['fields'][number] | null {
  const matches = secret.fields.filter(field => field.key === fieldKey)
  return matches.length === 1 ? matches[0] : null
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
  addSecretsToEnvProject: (folderId: string, projectId: string, secrets: AgentProjectSecretDraft[]) => Promise<VaultSecret[]>
  updateSecret: (folderId: string, s: VaultSecret, authoredRevision?: number) => Promise<void>
  setSecretProviderLink: (
    folderId: string,
    secretId: string,
    link: { providerId: string; remoteName: string; status: 'active' | 'revoked' | 'missing' } | null,
  ) => Promise<void>
  deleteSecret: (folderId: string, secretId: string) => Promise<void>
  trackUsage:   (folderId: string, secretId: string) => void
  copySecretField: (secretId: string, fieldKey: string, options?: { clearAfterMs?: number; fieldId?: string }) => Promise<boolean>
  copySecretImageField: (secretId: string, fieldKey: string, fieldId?: string) => Promise<boolean>
  revealSecretField: (secretId: string, fieldKey: string, options?: { pin?: string; fieldId?: string }) => Promise<string | null>
  revealSecretImageField: (secretId: string, fieldKey: string, options?: { pin?: string; fieldId?: string }) => Promise<string | null>
  revealSecretFields: (secretId: string, options?: { pin?: string }) => Promise<RevealedSecretField[] | null>

  // Reveal PIN
  setRevealPin: (pin: string, masterPassword: string) => Promise<{ success?: boolean; wrongPassword?: boolean; error?: string }>
  clearRevealPin: (masterPassword: string) => Promise<{ success?: boolean; wrongPassword?: boolean; error?: string }>

  // Providers
  addProvider:    (p: Omit<Provider, 'id'>, authorization?: ProviderMutationAuthorization) => Promise<void>
  updateProvider: (p: Provider, authorization?: ProviderMutationAuthorization) => Promise<void>
  updateProviderAndSecret: (
    p: Provider,
    folderId: string,
    s: VaultSecret,
    authorization?: ProviderMutationAuthorization,
  ) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  addProviderGroup:    (name: string) => Promise<void>
  renameProviderGroup: (id: string, name: string) => Promise<void>
  deleteProviderGroup: (id: string) => Promise<void>
  moveProvider: (providerId: string, groupId: string | null, targetProviderId?: string, position?: 'before' | 'after') => Promise<void>

  // Env projects
  addEnvProject:    (p: Omit<EnvProject, 'id'>, replaceProjectId?: string) => Promise<EnvProject | null>
  updateEnvProject: (p: EnvProject) => Promise<void>
  updateEnvProjects: (projects: EnvProject[]) => Promise<void>
  activateEnvProject: (projectId: string, replaceProjectId?: string) => Promise<void>
  deleteEnvProject: (id: string) => Promise<void>

  // Preferences
  setPreferences:   (patch: Partial<VaultPreferences>) => Promise<void>
}

const VaultCtx = createContext<Ctx | null>(null)

type AgentProjectSecretDraft = {
  envKey: string
  fieldKey: string
  secret: SecretDraft
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    screen: 'checking', vault: null,
    selectedFolderId: null, selectedSecretId: null,
    error: null, saving: false,
    justCompletedSetup: false,
  })
  const vaultRef = useRef<VaultRoot | null>(null)
  const sessionGuardRef = useRef(new RendererVaultSessionGuard())
  const mutationQueueRef = useRef(new RendererVaultMutationQueue())

  useEffect(() => {
    if (!sessionGuardRef.current.unlocked || !state.vault) return
    if (canInstallVaultSnapshot(vaultRef.current, state.vault, true)) {
      vaultRef.current = state.vault
    }
  }, [state.vault])

  const installNewerSnapshot = useCallback((vault: VaultRoot, action: 'update' | 'remote'): VaultRoot => {
    const current = vaultRef.current
    if (!sessionGuardRef.current.unlocked || !current) return current ?? vault
    if (!canInstallVaultSnapshot(current, vault)) return current
    vaultRef.current = vault
    if (action === 'remote') {
      dispatch({ type: 'REMOTE_VAULT_CHANGED', vault, revision: vault.revision ?? 1 })
    } else {
      dispatch({ type: 'UPDATE_VAULT', vault })
    }
    return vault
  }, [])

  useEffect(() => {
    window.vault.status()
      .then(({ needsSetup, incomplete, error }) => {
        if (incomplete) {
          dispatch({
            type: 'SET_RECOVERY',
            error: error ?? 'Vault authentication state is incomplete. Restore a validated backup.',
          })
          return
        }
        dispatch({ type: 'SET_SCREEN', screen: needsSetup ? 'needs_setup' : 'locked' })
      })
      .catch((err) => dispatch({
        type: 'SET_RECOVERY',
        error: `Vaultage could not inspect the local vault safely: ${err instanceof Error ? err.message : String(err)}`,
      }))
  }, [])

  useEffect(() => window.vault.onVaultChanged(change => {
    if (!change || typeof change.revision !== 'number' || !change.data) return
    try {
      const vault = normaliseVault(change.data)
      installNewerSnapshot(vault, 'remote')
    } catch (err) {
      console.error('[vault] Rejected invalid vault-change event:', err)
    }
  }), [installNewerSnapshot])

  // ── Persistence ──────────────────────────────────────────────────────────────

  const commitVaultCommand = useCallback(async (
    mutationId: string,
    expectedRevision: number,
    command: VaultMutationCommand,
    sessionEpoch: number,
  ): Promise<{ vault: VaultRoot; result: unknown }> => {
    dispatch({ type: 'SET_SAVING', saving: true })
    try {
      const invoke = () => window.vault.mutate({ mutationId, expectedRevision, command })
      let res
      try {
        res = await invoke()
      } catch {
        // A transport failure can happen after the main process durably commits.
        // Retry once with the same idempotency key; the receipt path returns the
        // prior result without applying or auditing the command twice.
        if (!sessionGuardRef.current.isCurrent(sessionEpoch)) {
          throw new RendererVaultSessionChangedError()
        }
        res = await invoke()
      }
      if (!sessionGuardRef.current.isCurrent(sessionEpoch)) {
        throw new RendererVaultSessionChangedError()
      }
      if (!res.success && res.stale && res.data) {
        const latest = normaliseVault(res.data)
        installNewerSnapshot(latest, 'remote')
      }
      if (!res.success) throw new Error(res.error ?? 'Could not save vault')
      if (!res.data) throw new Error('Vault mutation did not return an updated snapshot')
      const saved = normaliseVault(res.data)
      const installed = installNewerSnapshot(saved, 'update')
      return { vault: installed, result: res.result }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save vault'
      if (err instanceof RendererVaultSessionChangedError) throw err
      dispatch({ type: 'SET_ERROR', error: message })
      toast.error(message)
      throw err
    } finally {
      if (sessionGuardRef.current.isCurrent(sessionEpoch)) {
        dispatch({ type: 'SET_SAVING', saving: false })
      }
    }
  }, [installNewerSnapshot])

  const runVaultCommand = useCallback(<T,>(
    command: VaultMutationCommand,
    resolve: (result: unknown, vault: VaultRoot) => T,
    authoredRevision?: number,
  ): Promise<T> => {
    const authoredAgainst = vaultRef.current
    if (!authoredAgainst) return Promise.reject(new Error('Vaultage is locked'))
    const sessionEpoch = sessionGuardRef.current.epoch
    const expectedRevision = authoredRevision ?? authoredAgainst.revision ?? 1
    const mutationId = crypto.randomUUID()
    // Snapshot the user's intent before it waits behind another commit. React
    // objects must not be able to change the eventual IPC payload by reference.
    const queuedCommand = structuredClone(command)
    return mutationQueueRef.current.enqueue(
      sessionEpoch,
      epoch => Boolean(vaultRef.current) && sessionGuardRef.current.isCurrent(epoch),
      async () => {
        // Use the revision that the UI actually read while authoring this
        // command. Reading the revision only after the queue drains would let a
        // stale full-entity update masquerade as a newer intent.
        const committed = await commitVaultCommand(mutationId, expectedRevision, queuedCommand, sessionEpoch)
        return resolve(committed.result, committed.vault)
      },
    )
  }, [commitVaultCommand])

  const persistDefaultFolders = useCallback((prepared: ReturnType<typeof prepareUnlockedVault>) => {
    if (!prepared.changed) return
    void runVaultCommand(
      { type: 'bootstrap.defaults', folders: prepared.defaultFolders },
      () => undefined,
    ).catch(err => console.error('[vault] Failed to save default folders:', err))
  }, [runVaultCommand])

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const setup = useCallback(async (password: string) => {
    const authEpoch = sessionGuardRef.current.captureAuthAttempt()
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.setup(password)
    if (!sessionGuardRef.current.isAuthAttemptCurrent(authEpoch)) return
    if (res.success && res.data) {
      const prepared = prepareUnlockedVault(res.data)
      sessionGuardRef.current.begin()
      mutationQueueRef.current.reset()
      vaultRef.current = prepared.vault
      dispatch({ type: 'UNLOCK', vault: prepared.vault, justCompletedSetup: true })
      persistDefaultFolders(prepared)
    } else dispatch({ type: 'SET_ERROR', error: res.error ?? 'Setup failed' })
  }, [persistDefaultFolders])

  const unlockTouchID = useCallback(async () => {
    const authEpoch = sessionGuardRef.current.captureAuthAttempt()
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.touchID()
    if (!sessionGuardRef.current.isAuthAttemptCurrent(authEpoch)) return { cancelled: true }
    if (res.success && res.data) {
      const prepared = prepareUnlockedVault(res.data)
      sessionGuardRef.current.begin()
      mutationQueueRef.current.reset()
      vaultRef.current = prepared.vault
      dispatch({ type: 'UNLOCK', vault: prepared.vault })
      persistDefaultFolders(prepared)
    } else if (!res.cancelled) dispatch({ type: 'SET_ERROR', error: res.error ?? 'Touch ID failed' })
    return {
      notFound: res.notFound,
      cancelled: res.cancelled,
      authFailed: res.authFailed,
      touchIdInvalid: res.touchIdInvalid,
    }
  }, [persistDefaultFolders])

  const unlockPassword = useCallback(async (password: string) => {
    const authEpoch = sessionGuardRef.current.captureAuthAttempt()
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.password(password)
    if (!sessionGuardRef.current.isAuthAttemptCurrent(authEpoch)) return { success: false }
    if (res.success && res.data) {
      const prepared = prepareUnlockedVault(res.data)
      sessionGuardRef.current.begin()
      mutationQueueRef.current.reset()
      vaultRef.current = prepared.vault
      dispatch({ type: 'UNLOCK', vault: prepared.vault })
      persistDefaultFolders(prepared)
    } else dispatch({ type: 'SET_ERROR', error: res.error ?? 'Unlock failed' })
    return { success: res.success, wrongPassword: res.wrongPassword, touchIdRestored: res.touchIdRestored }
  }, [persistDefaultFolders])

  const lock = useCallback(async () => {
    sessionGuardRef.current.end()
    mutationQueueRef.current.reset()
    vaultRef.current = null
    dispatch({ type: 'LOCK' })
    await window.vault.lock()
  }, [])

  const signOut = useCallback(async () => {
    dispatch({ type: 'SET_ERROR', error: null })
    // Invalidate queued and in-flight work before the destructive auth call.
    // If main rejects sign-out, begin a fresh renderer epoch around the same
    // still-unlocked snapshot rather than reviving the invalidated epoch.
    const invalidatedEpoch = sessionGuardRef.current.end()
    mutationQueueRef.current.reset()
    let res
    try {
      res = await window.vault.signOut()
    } catch (error) {
      if (sessionGuardRef.current.epoch === invalidatedEpoch) {
        sessionGuardRef.current.begin()
        mutationQueueRef.current.reset()
        dispatch({ type: 'SET_SAVING', saving: false })
      }
      const message = error instanceof Error ? error.message : 'Could not sign out'
      dispatch({ type: 'SET_ERROR', error: message })
      throw error
    }
    if (sessionGuardRef.current.epoch !== invalidatedEpoch) return
    if (res.success) {
      vaultRef.current = null
      dispatch({ type: 'LOCK' })
    } else {
      sessionGuardRef.current.begin()
      mutationQueueRef.current.reset()
      dispatch({ type: 'SET_SAVING', saving: false })
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
    const folder: VaultFolder = { id: crypto.randomUUID(), name, children: [], secrets: [], itemOrder: [] }
    await runVaultCommand({ type: 'folder.create', parentId, folder }, () => undefined)
  }, [runVaultCommand])

  const renameFolder = useCallback(async (id: string, name: string) => {
    await runVaultCommand({ type: 'folder.rename', folderId: id, name }, () => undefined)
  }, [runVaultCommand])

  const deleteFolder = useCallback(async (id: string) => {
    const rootId = await runVaultCommand(
      { type: 'folder.delete', folderId: id },
      (result, vault) => commandResultString(result, 'rootId') ?? vault.root.id,
    )
    if (state.selectedFolderId === id) dispatch({ type: 'SELECT_FOLDER', id: rootId })
  }, [state.selectedFolderId, runVaultCommand])

  const duplicateFolder = useCallback(async (id: string) => {
    const duplicated = await runVaultCommand(
      { type: 'folder.duplicate', folderId: id },
      result => commandFolderImportResult(result),
    )
    if (!duplicated) return
    dispatch({ type: 'SELECT_FOLDER', id: duplicated.folderId })
    if (duplicated.firstSecretId) dispatch({ type: 'SELECT_SECRET', id: duplicated.firstSecretId })
  }, [runVaultCommand])

  const moveTreeItem = useCallback(async (item: VaultTreeItemRef, target: VaultTreeMoveTarget) => {
    const moved = await runVaultCommand(
      { type: 'folder.move-item', item, target },
      result => commandMoveResult(result),
    )
    if (!moved) return
    if (moved.selectedFolderId) dispatch({ type: 'SELECT_FOLDER', id: moved.selectedFolderId })
    if (moved.selectedSecretId) dispatch({ type: 'SELECT_SECRET', id: moved.selectedSecretId })
  }, [runVaultCommand])

  const sortFolderItems = useCallback(async (folderId: string, options: VaultFolderSortOptions) => {
    await runVaultCommand(
      { type: 'folder.sort', folderId, key: options.key, direction: options.direction },
      () => undefined,
    )
  }, [runVaultCommand])

  const importFolderTree = useCallback(async (
    parentId: string,
    folder: VaultFolder,
    selectedSecretIds?: Set<string>,
  ): Promise<ImportedFolderTreeResult> => {
    return runVaultCommand(
      {
        type: 'folder.import',
        parentId,
        folder,
        selectedSecretIds: selectedSecretIds ? [...selectedSecretIds] : undefined,
      },
      result => commandFolderImportResult(result)
        ?? { folderId: parentId, firstSecretId: null, secretCount: 0 },
    )
  }, [runVaultCommand])

  // ── Secrets ──────────────────────────────────────────────────────────────────

  const addSecrets = useCallback(async (folderId: string, secrets: SecretDraft[]) => {
    if (secrets.length === 0) return []
    const now = new Date().toISOString()
    const created: VaultSecret[] = secrets.map(s => ({
      ...s,
      fields: s.fields.map(field => ({ ...field, id: field.id ?? crypto.randomUUID() })),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))
    await runVaultCommand({ type: 'secret.create-many', folderId, secrets: created }, () => undefined)
    return created
  }, [runVaultCommand])

  const addSecret = useCallback(async (folderId: string, data: SecretDraft) => {
    await addSecrets(folderId, [data])
  }, [addSecrets])

  const addSecretsToEnvProject = useCallback(async (
    folderId: string,
    projectId: string,
    drafts: AgentProjectSecretDraft[],
  ) => {
    if (drafts.length === 0) return []
    const now = new Date().toISOString()
    const created: VaultSecret[] = drafts.map(({ secret }) => ({
      ...secret,
      fields: secret.fields.map(field => ({ ...field, id: field.id ?? crypto.randomUUID() })),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))
    const entries: EnvEntry[] = drafts.map((draft, index) => ({
      envKey: draft.envKey,
      fieldKey: draft.fieldKey,
      fieldId: uniqueFieldByKey(created[index], draft.fieldKey)?.id,
      secretId: created[index].id,
    }))

    await runVaultCommand({
      type: 'secret.create-many-and-map',
      folderId,
      projectId,
      secrets: created,
      entries,
    }, () => undefined)
    return created
  }, [runVaultCommand])

  const updateSecret = useCallback(async (
    folderId: string,
    secret: VaultSecret,
    authoredRevision?: number,
  ) => {
    await runVaultCommand({ type: 'secret.update', folderId, secret }, () => undefined, authoredRevision)
  }, [runVaultCommand])

  const setSecretProviderLink = useCallback(async (
    folderId: string,
    secretId: string,
    link: { providerId: string; remoteName: string; status: 'active' | 'revoked' | 'missing' } | null,
  ) => {
    await runVaultCommand({ type: 'secret.provider-link.set', folderId, secretId, link }, () => undefined)
  }, [runVaultCommand])

  const deleteSecret = useCallback(async (folderId: string, secretId: string) => {
    await runVaultCommand({ type: 'secret.delete', folderId, secretId }, () => undefined)
    if (state.selectedSecretId === secretId) dispatch({ type: 'SELECT_SECRET', id: null })
  }, [state.selectedSecretId, runVaultCommand])

  // Fire-and-forget main-process mutation; doesn't block the copy UX.
  const trackUsage = useCallback((folderId: string, secretId: string) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!state.vault || !sessionGuardRef.current.isCurrent(sessionEpoch)) return
    void folderId
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt: new Date().toISOString() })
    window.vault.trackUsage({ secretId }).then(res => {
      if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return
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
    options?: { clearAfterMs?: number; fieldId?: string },
  ) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!state.vault || !sessionGuardRef.current.isCurrent(sessionEpoch)) return false
    const usedAt = new Date().toISOString()
    const res = await window.vault.copySecretField({
      secretId,
      fieldKey,
      fieldId: options?.fieldId,
      clearAfterMs: options?.clearAfterMs,
    })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return false
    if (!res.success) {
      console.error('[vault] Failed to copy secret field:', res.error)
      return false
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return true
  }, [state.vault])

  const copySecretImageField = useCallback(async (secretId: string, fieldKey: string, fieldId?: string) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!state.vault || !sessionGuardRef.current.isCurrent(sessionEpoch)) return false
    const usedAt = new Date().toISOString()
    const res = await window.vault.copySecretImageField({ secretId, fieldKey, fieldId })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return false
    if (!res.success) {
      console.error('[vault] Failed to copy secret image field:', res.error)
      return false
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return true
  }, [state.vault])

  const revealSecretField = useCallback(async (secretId: string, fieldKey: string, options?: { pin?: string; fieldId?: string }) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!state.vault || !sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    const usedAt = new Date().toISOString()
    const confirmationPhrase = options?.pin ? undefined : secretRevealConfirmationPhrase()
    if (confirmationPhrase === null) return null
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    const res = await window.vault.revealSecretField({
      secretId,
      fieldKey,
      fieldId: options?.fieldId,
      confirmationPhrase,
      pin: options?.pin,
    })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    if (!res.success || typeof res.value !== 'string') {
      console.error('[vault] Failed to reveal secret field:', res.error)
      return null
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return res.value
  }, [state.vault])

  const revealSecretImageField = useCallback(async (secretId: string, fieldKey: string, options?: { pin?: string; fieldId?: string }) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!state.vault || !sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    const usedAt = new Date().toISOString()
    const confirmationPhrase = options?.pin ? undefined : secretRevealConfirmationPhrase()
    if (confirmationPhrase === null) return null
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    const res = await window.vault.revealSecretImageField({
      secretId,
      fieldKey,
      fieldId: options?.fieldId,
      confirmationPhrase,
      pin: options?.pin,
    })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    if (!res.success || typeof res.value !== 'string') {
      console.error('[vault] Failed to reveal secret image field:', res.error)
      return null
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return res.value
  }, [state.vault])

  const revealSecretFields = useCallback(async (secretId: string, options?: { pin?: string }) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!state.vault || !sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    const usedAt = new Date().toISOString()
    const confirmationPhrase = options?.pin ? undefined : secretRevealConfirmationPhrase()
    if (confirmationPhrase === null) return null
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    const res = await window.vault.revealSecretFields({ secretId, confirmationPhrase, pin: options?.pin })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) return null
    if (!res.success || !Array.isArray(res.fields)) {
      console.error('[vault] Failed to reveal secret fields:', res.error)
      return null
    }
    dispatch({ type: 'TRACK_USAGE', secretId, usedAt })
    if (typeof res.revision === 'number') dispatch({ type: 'SET_REVISION', revision: res.revision })
    return res.fields
  }, [state.vault])

  const setRevealPin = useCallback(async (pin: string, masterPassword: string) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) {
      return { success: false, error: 'Vaultage is locked' }
    }
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.setRevealPin({ pin, masterPassword })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) {
      return { success: false, error: 'Vault session changed' }
    }
    if (res.success && res.data) {
      const vault = normaliseVault(res.data)
      installNewerSnapshot(vault, 'update')
    } else if (!res.success) {
      dispatch({ type: 'SET_ERROR', error: res.error ?? 'Could not set reveal PIN' })
    }
    return { success: res.success, wrongPassword: res.wrongPassword, error: res.error }
  }, [installNewerSnapshot])

  const clearRevealPin = useCallback(async (masterPassword: string) => {
    const sessionEpoch = sessionGuardRef.current.epoch
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) {
      return { success: false, error: 'Vaultage is locked' }
    }
    dispatch({ type: 'SET_ERROR', error: null })
    const res = await window.vault.clearRevealPin({ masterPassword })
    if (!sessionGuardRef.current.isCurrent(sessionEpoch)) {
      return { success: false, error: 'Vault session changed' }
    }
    if (res.success && res.data) {
      const vault = normaliseVault(res.data)
      installNewerSnapshot(vault, 'update')
    } else if (!res.success) {
      dispatch({ type: 'SET_ERROR', error: res.error ?? 'Could not clear reveal PIN' })
    }
    return { success: res.success, wrongPassword: res.wrongPassword, error: res.error }
  }, [installNewerSnapshot])

  // ── Providers ────────────────────────────────────────────────────────────────

  const addProvider = useCallback(async (
    p: Omit<Provider, 'id'>,
    authorization?: ProviderMutationAuthorization,
  ) => {
    const category = p.groupId == null ? providerTypeCategory(p.type) : null
    const provider: Provider = { ...p, id: crypto.randomUUID(), groupId: p.groupId ?? undefined }
    await runVaultCommand({
      type: 'provider.create',
      provider,
      categoryId: category ?? undefined,
      categoryLabel: category ? serviceCategoryLabel(category) : undefined,
      ...(authorization?.verificationGrant
        ? { verificationGrant: authorization.verificationGrant }
        : {}),
    }, () => undefined, authorization?.expectedRevision)
  }, [runVaultCommand])

  const updateProvider = useCallback(async (
    p: Provider,
    authorization?: ProviderMutationAuthorization,
  ) => {
    await runVaultCommand({
      type: 'provider.update',
      provider: p,
      ...(authorization?.verificationGrant
        ? { verificationGrant: authorization.verificationGrant }
        : {}),
    }, () => undefined, authorization?.expectedRevision)
  }, [runVaultCommand])

  const updateProviderAndSecret = useCallback(async (
    p: Provider,
    folderId: string,
    secret: VaultSecret,
    authorization?: ProviderMutationAuthorization,
  ) => {
    await runVaultCommand({
      type: 'provider.update-with-secret',
      provider: p,
      folderId,
      secret,
      ...(authorization?.verificationGrant
        ? { verificationGrant: authorization.verificationGrant }
        : {}),
    }, () => undefined, authorization?.expectedRevision)
  }, [runVaultCommand])

  const deleteProvider = useCallback(async (id: string) => {
    await runVaultCommand({ type: 'provider.delete', providerId: id }, () => undefined)
  }, [runVaultCommand])

  const addProviderGroup = useCallback(async (name: string) => {
    const group: ProviderGroup = { id: crypto.randomUUID(), name }
    await runVaultCommand({ type: 'provider-group.create', group }, () => undefined)
  }, [runVaultCommand])

  const renameProviderGroup = useCallback(async (id: string, name: string) => {
    await runVaultCommand({ type: 'provider-group.rename', groupId: id, name }, () => undefined)
  }, [runVaultCommand])

  const deleteProviderGroup = useCallback(async (id: string) => {
    await runVaultCommand({ type: 'provider-group.delete', groupId: id }, () => undefined)
  }, [runVaultCommand])

  const moveProvider = useCallback(async (providerId: string, groupId: string | null, targetProviderId?: string, position?: 'before' | 'after') => {
    await runVaultCommand({
      type: 'provider.move',
      providerId,
      groupId,
      targetProviderId,
      position,
    }, () => undefined)
  }, [runVaultCommand])

  // ── Env projects ─────────────────────────────────────────────────────────────

  const addEnvProject = useCallback(async (p: Omit<EnvProject, 'id'>, replaceProjectId?: string) => {
    const project = ensureProjectEnvironments({ ...p, id: crypto.randomUUID() })
    await runVaultCommand({
      type: 'env-project.create', project,
      ...(replaceProjectId ? { replaceProjectId } : {}),
    }, () => undefined)
    return project
  }, [runVaultCommand])

  const updateEnvProject = useCallback(async (p: EnvProject) => {
    const project = ensureProjectEnvironments(p)
    await runVaultCommand({ type: 'env-project.update', project }, () => undefined)
  }, [runVaultCommand])

  const updateEnvProjects = useCallback(async (projects: EnvProject[]) => {
    await runVaultCommand({
      type: 'env-project.update-many',
      projects: projects.map(ensureProjectEnvironments),
    }, () => undefined)
  }, [runVaultCommand])

  const activateEnvProject = useCallback(async (projectId: string, replaceProjectId?: string) => {
    await runVaultCommand({
      type: 'env-project.activate',
      projectId,
      ...(replaceProjectId ? { replaceProjectId } : {}),
    }, () => undefined)
  }, [runVaultCommand])

  const deleteEnvProject = useCallback(async (id: string) => {
    await runVaultCommand({ type: 'env-project.delete', projectId: id }, () => undefined)
  }, [runVaultCommand])

  // ── Preferences ──────────────────────────────────────────────────────────────

  const setPreferences = useCallback(async (patch: Partial<VaultPreferences>) => {
    await runVaultCommand({ type: 'preferences.patch', patch }, () => undefined)
  }, [runVaultCommand])

  const value = useMemo<Ctx>(() => ({
    state, setup, unlockTouchID, unlockPassword, lock, signOut,
    selectFolder, selectSecret,
    addFolder, renameFolder, deleteFolder, duplicateFolder, moveTreeItem, sortFolderItems, importFolderTree,
    addSecret, addSecrets, addSecretsToEnvProject, updateSecret, setSecretProviderLink, deleteSecret, trackUsage, copySecretField, copySecretImageField,
    revealSecretField, revealSecretImageField, revealSecretFields,
    setRevealPin, clearRevealPin,
    addProvider, updateProvider, updateProviderAndSecret, deleteProvider,
    addProviderGroup, renameProviderGroup, deleteProviderGroup, moveProvider,
    addEnvProject, updateEnvProject, updateEnvProjects, activateEnvProject, deleteEnvProject,
    setPreferences,
  }), [
    state,
    setup, unlockTouchID, unlockPassword, lock, signOut,
    selectFolder, selectSecret,
    addFolder, renameFolder, deleteFolder, duplicateFolder, moveTreeItem, sortFolderItems, importFolderTree,
    addSecret, addSecrets, addSecretsToEnvProject, updateSecret, setSecretProviderLink, deleteSecret, trackUsage, copySecretField, copySecretImageField,
    revealSecretField, revealSecretImageField, revealSecretFields,
    setRevealPin, clearRevealPin,
    addProvider, updateProvider, updateProviderAndSecret, deleteProvider,
    addProviderGroup, renameProviderGroup, deleteProviderGroup, moveProvider,
    addEnvProject, updateEnvProject, updateEnvProjects, activateEnvProject, deleteEnvProject,
    setPreferences,
  ])

  return (
    <VaultCtx.Provider value={value}>
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
