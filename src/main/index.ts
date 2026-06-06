import { app, BrowserWindow, ipcMain, powerMonitor, nativeImage, session } from 'electron'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { appendAuditEvent, deriveAuditMacKey, type AuditEventType } from './audit'
import { ensureAgentApiToken } from '#agent-auth-token'
import { registerAgentIpc } from '#agent-ipc'
import { resolveAgentReleaseSelections } from '#agent-release'
import { AgentServerController, validateAgentApiPort } from '#agent-server'
import { AuthController } from './auth'
import { installAutoUpdateChecks } from './autoUpdate'
import { installRendererCsp } from './contentSecurityPolicy'
import { IdleAutoLockController } from './idleAutoLock'
import { registerAuthIpc } from './authIpc'
import { registerAuditIpc } from './auditIpc'
import { registerModeIpc } from './modeIpc'
import { registerPlatformIpc } from './platformIpc'
import { registerProjectIpc } from './projectIpc'
import { registerVaultIpc } from './vaultIpc'
import { redactVaultForRenderer } from './vaultRedaction'
import { registerProviderIpc } from '#provider-ipc'
import { ProviderWorkerClient } from '#provider-worker-client'
import { IS_MAC, keychainRemove, keychainRetrieve, keychainStore } from './keychain'
import { disableSecureInput } from './secureInput'
import { createMainWindow, iconPath } from './window'
import {
  AUDIT_LOG_FILE,
  PARAMS_FILE,
  WRAPPED_KEY_FILE,
  ensureVaultDir,
  readVault,
  writeParams,
  writeVault,
  writeWrappedKey,
} from './vaultStorage'
import type { AppMode } from './security'

// In-memory vault key — Buffer.fill(0) + null on lock/quit
let vaultKey:    Buffer | null      = null
let mainWindow:  BrowserWindow | null = null
let auditQueue = Promise.resolve()
const providerClient = new ProviderWorkerClient()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
let idleAutoLock: IdleAutoLockController | null = null
let agentApiToken: string | null = null
let vaultRevision = 0

// ── App mode ──────────────────────────────────────────────────────────────────
let appMode: AppMode = 'local'

function shouldUseContentProtection(): boolean {
  if (process.env.VAULTAGE_DISABLE_CONTENT_PROTECTION === '1') return false
  if (!app.isPackaged && process.env.VAULTAGE_ENABLE_CONTENT_PROTECTION !== '1') return false
  return true
}

function shouldProtectWindowContent(): boolean {
  return shouldUseContentProtection() && (Boolean(vaultKey) || agentServer.pendingCount() > 0)
}

function syncWindowContentProtection(): void {
  mainWindow?.setContentProtection(shouldProtectWindowContent())
}

const authController = new AuthController({
  getVaultKey: () => vaultKey,
  setVaultKey: (key) => {
    vaultKey = key
    syncWindowContentProtection()
  },
  normalizeVaultData: prepareVaultForRenderer,
  keychain: {
    isMac: IS_MAC,
    retrieve: keychainRetrieve,
    store: keychainStore,
    remove: keychainRemove,
  },
  storage: {
    accessParams: () => fs.access(PARAMS_FILE),
    ensureVaultDir,
    readParams: () => fs.readFile(PARAMS_FILE, 'utf8'),
    writeParams,
    readWrappedKey: () => fs.readFile(WRAPPED_KEY_FILE),
    writeWrappedKey,
    readVault,
    writeVault,
  },
  randomId: randomUUID,
  recordAudit,
})

const agentServer = new AgentServerController({
  getMode: () => appMode,
  hasVaultKey: () => Boolean(vaultKey),
  shouldProtectContent: shouldUseContentProtection,
  getAuthToken: () => agentApiToken,
  getWindow: () => mainWindow,
  confirmUserPresence: (prompt, phrase) => authController.confirmAgentApproval(prompt, phrase),
  resolveReleaseSelections: async (selections) => {
    if (!vaultKey) throw new Error('Not authenticated')
    return resolveAgentReleaseSelections(await readVault(vaultKey), selections)
  },
  recordAudit,
})

function recordAudit(type: AuditEventType, details: Record<string, unknown> = {}): void {
  const auditMacKey = vaultKey ? deriveAuditMacKey(vaultKey) : null
  if (!auditMacKey) {
    console.warn('[audit] skipped event without vault key:', type)
    return
  }
  auditQueue = auditQueue
    .catch(() => undefined)
    .then(() => appendAuditEvent(AUDIT_LOG_FILE, type, details, auditMacKey))
    .finally(() => auditMacKey.fill(0))
    .then(() => undefined)
  void auditQueue.catch((err) => {
    console.error('[audit] Failed to append event:', err)
  })
}

async function flushAuditQueue(): Promise<void> {
  await auditQueue.catch(() => undefined)
}

registerAuthIpc(ipcMain, authController)
registerVaultIpc(ipcMain, {
  getVaultKey: () => vaultKey,
  getVaultRevision: () => vaultRevision,
  setVaultRevision: (revision) => { vaultRevision = revision },
  lockVault,
  authController,
  recordAudit,
  quitApp: () => setTimeout(() => app.quit(), 0),
})
registerModeIpc(ipcMain, {
  getMode: () => appMode,
  setMode: (mode) => { appMode = mode },
  getWindow: () => mainWindow,
  agentServer,
  recordAudit,
})
registerAuditIpc(ipcMain, {
  hasVaultKey: () => Boolean(vaultKey),
  getAuditMacKey: () => vaultKey ? deriveAuditMacKey(vaultKey) : null,
  flushAuditQueue,
  recordAudit,
})

// ── IPC: providers ────────────────────────────────────────────────────────────
// Provider IPC is registered through the edition alias. Open source builds get
// a no-op registrar; private builds get the Services/provider surface.
registerProviderIpc(ipcMain, providerClient, recordAudit, {
  getVaultKey: () => vaultKey,
  readVault,
})
registerProjectIpc(ipcMain, {
  getVaultKey: () => vaultKey,
  readVault,
  authController,
  recordAudit,
})
registerAgentIpc(ipcMain, agentServer, {
  hasVaultKey: () => Boolean(vaultKey),
  getAgentApiToken: async () => {
    if (!agentApiToken) agentApiToken = await ensureAgentApiToken()
    return agentApiToken
  },
})
registerPlatformIpc(ipcMain)

// ── Window ────────────────────────────────────────────────────────────────────

function lockVault(notifyRenderer = true, reason = 'auto-lock') {
  const wasUnlocked = Boolean(vaultKey)
  disableSecureInput()
  agentServer.setApiEnabledState(false)
  agentServer.cancelPendingRequests('Vaultage locked')
  if (wasUnlocked) recordAudit('vault.lock', { reason })
  if (vaultKey) { vaultKey.fill(0); vaultKey = null }
  vaultRevision = 0
  syncWindowContentProtection()
  if (notifyRenderer) mainWindow?.webContents.send('vault:auto-lock')
}

function hydrateVaultRevision(vault: unknown): unknown {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) return vault
  const current = (vault as { revision?: unknown }).revision
  vaultRevision = Number.isInteger(current) && typeof current === 'number' && current > 0
    ? current
    : 1
  return { ...(vault as Record<string, unknown>), revision: vaultRevision }
}

function prepareVaultForRenderer(vault: unknown): unknown {
  const hydrated = hydrateVaultRevision(vault)
  syncAgentApiPortFromVault(hydrated)
  return redactVaultForRenderer(hydrated)
}

function syncAgentApiPortFromVault(vault: unknown): void {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) return
  const preferences = (vault as { preferences?: unknown }).preferences
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return
  const rawPort = (preferences as { agentApiPort?: unknown }).agentApiPort
  if (rawPort === undefined) return
  try {
    void agentServer.configurePort(validateAgentApiPort(rawPort))
  } catch (err) {
    console.warn('[vault-mode] Ignoring invalid saved local API port:', err instanceof Error ? err.message : String(err))
  }
}

function createWindow(): void {
  mainWindow = createMainWindow(() => {
    mainWindow = null
  })
  syncWindowContentProtection()
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setName('Vaultage Community')
  agentApiToken = await ensureAgentApiToken()
  installRendererCsp(session.defaultSession)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath()))
  }
  createWindow()
  installAutoUpdateChecks()
  idleAutoLock = new IdleAutoLockController({
    isUnlocked: () => Boolean(vaultKey),
    getSystemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    lock: (reason) => lockVault(true, reason),
  })
  idleAutoLock.start()
  // Server only starts when mode is explicitly set to 'agent'
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // Lock vault on system sleep or screen lock
  powerMonitor.on('suspend',     () => lockVault(true, 'system-suspend'))
  powerMonitor.on('lock-screen', () => lockVault(true, 'screen-lock'))
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  lockVault(false, 'window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  idleAutoLock?.stop()
  disableSecureInput()
})
