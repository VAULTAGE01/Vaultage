import { clipboard, type IpcMain } from 'electron'
import { Buffer } from 'buffer'
import { createHash, randomUUID } from 'crypto'
import { updateVault } from './vaultStorage'
import { validateVaultSaveJson } from './security'
import {
  assertPinnedSecretInVault,
  assertSecretRevealAllowedInVault,
  resolveSecretFieldInVault,
} from './vaultMutations'
import { redactVaultForRenderer } from './vaultRedaction'
import { vaultRevisionFrom } from './vaultIpcCommon'
import type { AuditEventType } from './audit'
import type { AuthController } from './auth'
import type { VaultSessionOperation } from './vaultSessionKey'
import { searchMenuPanelSecrets } from './menuPanelSearch'
import {
  hasQuickRevealPin,
  optionalQuickRevealPin,
  requireQuickRevealPin,
  resetQuickRevealPinThrottle,
} from './quickRevealPin'
import {
  menuPanelIpcContracts,
  type MainWindowNavigationIntent,
  type MenuPanelCreatePayload,
} from '../shared/menuPanelIpcContracts'
import type { VaultChangedEvent } from '../shared/vaultIpcContracts'
import { VAULT_VALIDATION_LIMITS } from '../shared/vaultValidation'

const DEFAULT_CLEAR_AFTER_MS = 45_000

export interface MenuPanelIpcDeps {
  appName: string
  openCoreBuild: boolean
  getVaultKey: () => Buffer | null
  beginSessionOperation: () => VaultSessionOperation | null
  recordSecretUsage: (secretId: string, usedAt?: string) => void
  getVaultRevision: () => number
  setVaultRevision: (revision: number) => void
  notifyVaultChanged: (change: VaultChangedEvent) => void
  readVault: (key: Buffer) => Promise<unknown>
  pendingCount: () => number
  isAgentListening: () => boolean
  hasAgentCapability: () => boolean | Promise<boolean>
  agentPort: () => number
  isBrowserEnabled: () => boolean
  hasBrowserCapability: () => boolean | Promise<boolean>
  showMainWindow: () => void
  navigateMainWindow: (intent: MainWindowNavigationIntent) => void
  closePanel: () => void
  lockVault: () => void
  startAgent: () => void | Promise<void>
  stopAgent: () => void | Promise<void>
  startBrowser: () => void | Promise<void>
  stopBrowser: () => void | Promise<void>
  copyAgentInstructions: () => void | Promise<void>
  quitApp: () => void
  authController: AuthController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  recordAuditDurable: (type: AuditEventType, details?: Record<string, unknown>) => Promise<void>
}

export function registerMenuPanelIpc(ipcMain: IpcMain, deps: MenuPanelIpcDeps): void {
  const panelIpc = menuPanelIpcContracts

  ipcMain.handle(panelIpc.status.channel, async (_, rawPayload: unknown) => {
    panelIpc.status.validate(rawPayload)
    const vaultKey = deps.getVaultKey()
    let quickRevealPinEnabled = false
    if (vaultKey) {
      try {
        quickRevealPinEnabled = hasQuickRevealPin(await deps.readVault(vaultKey))
      } catch {
        quickRevealPinEnabled = false
      }
    }
    const [agentAvailable, browserAvailable] = await Promise.all([
      availableCapability(deps.hasAgentCapability),
      availableCapability(deps.hasBrowserCapability),
    ])
    return {
      success: true,
      appName: deps.appName,
      unlocked: Boolean(vaultKey),
      pendingCount: deps.pendingCount(),
      agentListening: deps.isAgentListening(),
      agentAvailable,
      agentPort: deps.agentPort(),
      browserEnabled: deps.isBrowserEnabled(),
      browserAvailable,
      quickRevealPinEnabled,
      openCoreBuild: deps.openCoreBuild,
    }
  })

  ipcMain.handle(panelIpc.search.channel, async (_, rawPayload: unknown) => {
    const payload = panelIpc.search.validate(rawPayload)
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, locked: true, error: 'Vaultage is locked' }
    try {
      const vault = await deps.readVault(vaultKey)
      return {
        success: true,
        results: searchMenuPanelSecrets(vault, payload.query ?? '', payload.limit),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(panelIpc.copy.channel, async (_, rawPayload: unknown) => {
    const payload = panelIpc.copy.validate(rawPayload)
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    let clipboardFingerprint: string | null = null
    try {
      const pin = optionalQuickRevealPin(payload.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Copy saved secret value from Vaultage menu bar',
          payload.confirmationPhrase,
        )
        if (!confirmation.success) return confirmation
        resetQuickRevealPinThrottle()
      }
      const clearAfterMs = DEFAULT_CLEAR_AFTER_MS
      const vault = await deps.readVault(vaultKey)
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      if (pin) {
        assertPinnedSecretInVault(vault, payload.secretId)
        await requireQuickRevealPin(vault, pin)
      }
      operation.assertCurrent()
      const copiedValue = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      if (copiedValue.length > 1_000_000) throw new Error('Clipboard text is too large')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      clipboard.writeText(copiedValue)
      clipboardFingerprint = copiedValue ? textFingerprint(copiedValue) : null
      await deps.recordAuditDurable('vault.secret.copied', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'text',
        source: 'menu-bar',
        method: pin ? 'pin' : 'system',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      if (clearAfterMs > 0 && clipboardFingerprint) {
        const expectedFingerprint = clipboardFingerprint
        const timer = setTimeout(() => {
          if (textFingerprint(clipboard.readText()) === expectedFingerprint) clipboard.writeText('')
        }, clearAfterMs)
        timer.unref?.()
      }
      return { success: true }
    } catch (err) {
      if (clipboardFingerprint && textFingerprint(clipboard.readText()) === clipboardFingerprint) {
        clipboard.writeText('')
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(panelIpc.reveal.channel, async (_, rawPayload: unknown) => {
    const payload = panelIpc.reveal.validate(rawPayload)
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const pin = optionalQuickRevealPin(payload.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'View saved secret value from Vaultage menu bar',
          payload.confirmationPhrase,
        )
        if (!confirmation.success) return confirmation
        resetQuickRevealPinThrottle()
      }
      const vault = await deps.readVault(vaultKey)
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      if (pin) {
        assertPinnedSecretInVault(vault, payload.secretId)
        await requireQuickRevealPin(vault, pin)
      }
      operation.assertCurrent()
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      if (Buffer.byteLength(value, 'utf8') > 1_000_000) throw new Error('Secret field is too large to view')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      await deps.recordAuditDurable('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'text',
        source: 'menu-bar',
        method: pin ? 'pin' : 'system',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      return { success: true, value }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(panelIpc.create.channel, async (_, rawPayload: unknown) => {
    const payload = panelIpc.create.validate(rawPayload)
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const createdAt = new Date().toISOString()
      const draft = quickCreateSecret(payload, createdAt)
      const result = await updateVault(vaultKey, async (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const added = addSecretToDefaultFolder(vault, draft.secret, draft.folderName)
        const next = {
          ...(vault as Record<string, unknown>),
          root: added.root,
          revision: nextRevision,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return {
          json: safeJson,
          result: {
            revision: nextRevision,
            secretId: draft.secret.id,
            folderId: added.folderId,
            data: redactVaultForRenderer(next),
          },
        }
      })
      deps.setVaultRevision(result.revision)
      deps.notifyVaultChanged({ revision: result.revision, data: result.data, source: 'menu-panel-create' })
      deps.recordAudit('vault.secret.created', {
        vaultItemId: result.secretId,
        folderId: result.folderId,
        type: draft.secret.type,
        source: 'menu-bar',
        input: payload.kind,
      })
      const { data: _data, ...publicResult } = result
      return { success: true, ...publicResult }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(panelIpc.openApp.channel, (_, rawPayload: unknown) => {
    panelIpc.openApp.validate(rawPayload)
    deps.showMainWindow()
    return { success: true }
  })

  ipcMain.handle(panelIpc.action.channel, async (_, rawPayload: unknown) => {
    const payload = panelIpc.action.validate(rawPayload)
    try {
      if (payload.action === 'lock') {
        deps.lockVault()
        return { success: true }
      }
      if (payload.action === 'startAgent') {
        if (deps.openCoreBuild || !await deps.hasAgentCapability()) {
          return { success: false, error: 'Vaultage Pro Agent access is required' }
        }
        await deps.startAgent()
        return { success: true }
      }
      if (payload.action === 'stopAgent') {
        if (deps.openCoreBuild) return { success: false, error: 'Agent controls are unavailable in this build' }
        await deps.stopAgent()
        return { success: true }
      }
      if (payload.action === 'startBrowser') {
        if (deps.openCoreBuild || !await deps.hasBrowserCapability()) {
          return { success: false, error: 'Vaultage Pro browser extension access is required' }
        }
        await deps.startBrowser()
        return { success: true }
      }
      if (payload.action === 'stopBrowser') {
        if (deps.openCoreBuild) return { success: false, error: 'Browser controls are unavailable in this build' }
        await deps.stopBrowser()
        return { success: true }
      }
      if (payload.action === 'copyAgentInstructions') {
        if (deps.openCoreBuild || !await deps.hasAgentCapability()) {
          return { success: false, error: 'Vaultage Pro Agent access is required' }
        }
        await deps.copyAgentInstructions()
        return { success: true }
      }
      if (payload.action === 'openPendingRequests') {
        deps.navigateMainWindow('pending-requests')
        return { success: true }
      }
      if (payload.action === 'settings') {
        deps.navigateMainWindow('settings')
        return { success: true }
      }
      if (payload.action === 'quit') {
        deps.quitApp()
        return { success: true }
      }
      return { success: false, error: 'Unsupported menu panel action' }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(panelIpc.close.channel, (_, rawPayload: unknown) => {
    panelIpc.close.validate(rawPayload)
    deps.closePanel()
    return { success: true }
  })
}

async function availableCapability(check: () => boolean | Promise<boolean>): Promise<boolean> {
  try {
    return await check()
  } catch {
    return false
  }
}

function textFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

type QuickCreateSecret = {
  secret: Record<string, unknown>
  folderName: string
}

function quickCreateSecret(payload: MenuPanelCreatePayload, now: string): QuickCreateSecret {
  if (payload.kind === 'image') {
    const dataUrl = safeImageDataUrl(payload.dataUrl)
    return {
      folderName: 'Images',
      secret: {
        id: randomUUID(),
        name: cleanSecretName(payload.name, 'Pasted image'),
        type: 'image',
        fields: [{ key: '__image__', value: dataUrl, sensitive: true }],
        notes: '',
        createdAt: now,
        updatedAt: now,
        tags: ['menu-bar'],
      },
    }
  }

  return {
    folderName: 'Secure Notes',
    secret: {
      id: randomUUID(),
      name: cleanSecretName(payload.name, 'Pasted secret'),
      type: 'secureNote',
      fields: [{ key: 'Content', value: payload.value.trim(), sensitive: true }],
      notes: '',
      createdAt: now,
      updatedAt: now,
      tags: ['menu-bar'],
    },
  }
}

function addSecretToDefaultFolder(
  vault: unknown,
  secret: Record<string, unknown>,
  folderName: string,
): { root: unknown; folderId: string } {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new Error('Vault payload must be an object')
  }
  const root = (vault as { root?: unknown }).root
  if (!isRecord(root)) throw new Error('Vault payload root must be an object')

  const result = addSecretToFolderNamed(root, folderName, secret)
  if (result.added) return { root: result.folder, folderId: result.folderId }

  const rootId = typeof root.id === 'string' ? root.id : 'root'
  return {
    root: appendSecretToFolder(root, secret),
    folderId: rootId,
  }
}

function addSecretToFolderNamed(
  folder: Record<string, unknown>,
  folderName: string,
  secret: Record<string, unknown>,
): { folder: Record<string, unknown>; added: boolean; folderId: string } {
  if (folder.name === folderName) {
    return {
      folder: appendSecretToFolder(folder, secret),
      added: true,
      folderId: typeof folder.id === 'string' ? folder.id : '',
    }
  }

  let added = false
  let folderId = ''
  const children = Array.isArray(folder.children)
    ? folder.children.map(child => {
        if (added || !isRecord(child)) return child
        const result = addSecretToFolderNamed(child, folderName, secret)
        if (result.added) {
          added = true
          folderId = result.folderId
          return result.folder
        }
        return child
      })
    : folder.children

  return {
    folder: { ...folder, children },
    added,
    folderId,
  }
}

function appendSecretToFolder(folder: Record<string, unknown>, secret: Record<string, unknown>): Record<string, unknown> {
  const secrets = Array.isArray(folder.secrets) ? [...folder.secrets, secret] : [secret]
  const refs = orderedFolderItemRefs(folder)
  const secretId = typeof secret.id === 'string' ? secret.id : ''
  return {
    ...folder,
    secrets,
    itemOrder: secretId ? [...refs, { kind: 'secret', id: secretId }] : refs,
  }
}

function orderedFolderItemRefs(folder: Record<string, unknown>): Array<{ kind: 'folder' | 'secret'; id: string }> {
  const childIds = new Set(
    Array.isArray(folder.children)
      ? folder.children.filter(isRecord).map(child => child.id).filter((id): id is string => typeof id === 'string')
      : [],
  )
  const secretIds = new Set(
    Array.isArray(folder.secrets)
      ? folder.secrets.filter(isRecord).map(secret => secret.id).filter((id): id is string => typeof id === 'string')
      : [],
  )
  const seen = new Set<string>()
  const refs: Array<{ kind: 'folder' | 'secret'; id: string }> = []

  if (Array.isArray(folder.itemOrder)) {
    for (const item of folder.itemOrder) {
      if (!isRecord(item)) continue
      const kind = item.kind === 'folder' || item.kind === 'secret' ? item.kind : null
      const id = typeof item.id === 'string' ? item.id : ''
      if (!kind || !id || seen.has(`${kind}:${id}`)) continue
      if (kind === 'folder' && !childIds.has(id)) continue
      if (kind === 'secret' && !secretIds.has(id)) continue
      seen.add(`${kind}:${id}`)
      refs.push({ kind, id })
    }
  }

  for (const id of childIds) {
    if (!seen.has(`folder:${id}`)) refs.push({ kind: 'folder', id })
  }
  for (const id of secretIds) {
    if (!seen.has(`secret:${id}`)) refs.push({ kind: 'secret', id })
  }
  return refs
}

function cleanSecretName(value: string | undefined, fallback: string): string {
  const cleaned = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    : ''
  return cleaned ? cleaned.slice(0, 120) : `${fallback} ${new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function safeImageDataUrl(value: string): string {
  const match = /^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(value)
  if (!match) throw new Error('Image data must be a supported data URL')
  const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64')
  if (bytes.byteLength > VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes) {
    throw new Error('Image is too large')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
