import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, nativeImage, safeStorage, screen, session, shell, type MessageBoxOptions } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { appendAuditEvent, deriveAuditMacKey, readVerifiedAuditLog, type AuditEventType } from './audit'
import { AuditFailureGuard } from './auditFailureGuard'
import { ensureAgentApiToken } from '#agent-auth-token'
import { removeAgentDiscovery, writeAgentDiscovery } from '#agent-discovery'
import { agentInstructionsSnippet, registerAgentIpc } from '#agent-ipc'
import { resolveAgentReleaseSelections } from '#agent-release'
import { AgentServerController, validateAgentApiPort } from '#agent-server'
import {
  findExtensionHandoffArg,
  parseExtensionHandoffUrl,
  registerExtensionProtocol,
  sendExtensionHandoff,
  type ExtensionHandoff,
} from '#extension-handoff'
import { AuthController } from './auth'
import { installAutoUpdateChecks } from './autoUpdate'
import { installRendererCsp } from './contentSecurityPolicy'
import { createAuthorizedIpcMain } from './ipcAuthorization'
import { addExtensionCandidateToVault } from '#extension-candidate-vault'
import { IdleAutoLockController } from './idleAutoLock'
import { registerAuthIpc } from './authIpc'
import { registerAuditIpc } from './auditIpc'
import { registerModeIpc } from './modeIpc'
import { modeIpcEvents } from '../shared/modeIpcContracts'
import { menuPanelIpcEvents, type MainWindowNavigationIntent } from '../shared/menuPanelIpcContracts'
import { registerMenuPanelIpc } from './menuPanelIpc'
import { registerPlatformIpc } from './platformIpc'
import { registerProjectIpc } from './projectIpc'
import { ProjectPathCapabilityStore } from './projectCapabilities'
import { authorizeProjectPathMutation } from './projectMutationAuthorization'
import { registerVaultIpc } from './vaultIpc'
import { redactVaultForRenderer } from './vaultRedaction'
import { registerProviderIpc } from '#provider-ipc'
import { ProviderWorkerClient } from '#provider-worker-client'
import { IS_MAC, keychainRemove, keychainRetrieve, keychainStore } from './keychain'
import { disableSecureInput } from './secureInput'
import { createMainWindow, createMenuPanelWindow, iconPath, MENU_PANEL_PARTITION } from './window'
import { MenuBarController } from './menuBar'
import {
  AUDIT_LOG_FILE,
  VAULT_DIR,
  commitAuthCredentials,
  commitRestoredVaultState,
  createVaultState,
  ensureVaultDir,
  getAuthStateStatus,
  readCredentials,
  readRecoveryCredentials,
  readVault,
  updateVault,
} from './vaultStorage'
import { VaultSessionChangedError, VaultSessionKeyring } from './vaultSessionKey'
import { validateVaultSaveJson, type AppMode } from './security'
import { vaultIpcEvents, type VaultChangedEvent } from '../shared/vaultIpcContracts'
import { vaultRevisionFrom } from './vaultIpcCommon'
import { configureQuickRevealPinThrottleStore } from './quickRevealPin'
import { QuickRevealPinThrottleFileStore } from './quickRevealPinThrottleStore'
import { VaultUsageBatcher } from './vaultUsageBatcher'
import { pendingAuditEntriesFromVaultMutationReceipts } from './vaultMutationReceipts'
import { installCommercialRuntime, type CommercialRuntimeAccess } from '#commercial-runtime'
import { authorizeCommercialExtensionHandoff } from './featureCapabilityGate'
import { createExtensionNativeHostRegistrar } from '#extension-native-host-composition'
import {
  extensionNativeHostLaunchIssue,
  registerExtensionNativeHostIpc,
  requireInstalledExtensionNativeHost,
  type ExtensionNativeHostAction,
} from '#extension-native-host-ipc'

// The keyring owns the only long-lived key Buffer. Async operations receive
// tracked copies so lock can invalidate work without zeroing bytes in use.
const vaultSession = new VaultSessionKeyring()
let mainWindow:  BrowserWindow | null = null
let auditQueue = Promise.resolve()
let receiptAuditReconciliationQueue = Promise.resolve()
const OPEN_CORE_BUILD = typeof __VAULTAGE_OPEN_CORE__ !== 'undefined' && __VAULTAGE_OPEN_CORE__
const APP_DISPLAY_NAME = OPEN_CORE_BUILD ? 'vault-OC' : 'Vaultage'
app.setName(APP_DISPLAY_NAME)
const providerClient = new ProviderWorkerClient()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
let idleAutoLock: IdleAutoLockController | null = null
let agentApiToken: string | null = null
let vaultRevision = 0
let pendingExtensionHandoff: ExtensionHandoff | null = null
let pendingExtensionHandoffUrls: string[] = []
let menuBar: MenuBarController | null = null
let menuPanelWindow: BrowserWindow | null = null
let quitPreparing = false
let quitPrepared = false
let commercialRuntime: CommercialRuntimeAccess | null = null
const AGENT_INSTRUCTIONS_CLIPBOARD_CLEAR_MS = 30_000
configureQuickRevealPinThrottleStore(
  new QuickRevealPinThrottleFileStore(join(VAULT_DIR, 'reveal-pin-throttle')),
)
const mainWindowIpc = createAuthorizedIpcMain(
  ipcMain,
  () => mainWindow?.webContents ?? null,
  'main-window',
)
const menuPanelIpc = createAuthorizedIpcMain(
  ipcMain,
  () => menuPanelWindow?.webContents ?? null,
  'menu-panel',
)

// ── App mode ──────────────────────────────────────────────────────────────────
let appMode: AppMode = 'local'

function shouldUseContentProtection(): boolean {
  if (app.isPackaged) return true
  return process.env.VAULTAGE_ENABLE_CONTENT_PROTECTION === '1'
}

function shouldProtectWindowContent(): boolean {
  return shouldUseContentProtection() && (vaultSession.isUnlocked() || agentServer.pendingCount() > 0)
}

function syncWindowContentProtection(): void {
  mainWindow?.setContentProtection(shouldProtectWindowContent())
}

function syncMenuBar(): void {
  menuBar?.refresh()
}

function notifyVaultChanged(change: VaultChangedEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(vaultIpcEvents.changed, {
      ...change,
      data: usageBatcher.decorateSnapshot(change.data),
    })
  }
  syncMenuBar()
}

const usageBatcher = new VaultUsageBatcher({
  getVaultKey: () => vaultSession.currentKey(),
  getSessionEpoch: () => vaultSession.epoch,
  getVaultRevision: () => vaultRevision,
  setVaultRevision: (revision) => { vaultRevision = revision },
  onVaultChanged: notifyVaultChanged,
  updateVault,
  onBackgroundError: (err) => {
    console.error('[vault-usage] Failed to flush usage metadata:', err)
  },
  onDroppedUsage: (eventCount, reason) => {
    console.warn(`[vault-usage] Dropped ${eventCount} usage event(s): ${reason}`)
  },
})

const authController = new AuthController({
  session: {
    beginOperation: () => vaultSession.beginOperation(),
    leaseCurrentKey: () => vaultSession.leaseCurrentKey(),
    installKey: (key, expectedEpoch) => {
      const installed = vaultSession.installKey(key, expectedEpoch)
      if (installed) {
        providerRuntime.clearSessionAuthorizations()
        syncWindowContentProtection()
        syncMenuBar()
        scheduleMutationReceiptAuditReconciliation()
        void commercialRuntime?.resume()
      }
      return installed
    },
  },
  normalizeVaultData: prepareVaultForRenderer,
  keychain: {
    isMac: IS_MAC,
    retrieve: keychainRetrieve,
    store: keychainStore,
    remove: keychainRemove,
  },
  storage: {
    ensureVaultDir,
    getAuthStateStatus,
    readCredentials,
    readRecoveryCredentials,
    readVault,
    createVaultState,
    commitAuthCredentials,
    commitRestoredVaultState,
  },
  randomId: randomUUID,
  recordAudit,
})

const agentServer = new AgentServerController({
  getMode: () => appMode,
  hasVaultKey: () => vaultSession.isUnlocked(),
  shouldProtectContent: shouldUseContentProtection,
  onStateChanged: syncMenuBar,
  publishDiscovery: async (port, listenerId, startedAt) => {
    if (!agentApiToken) agentApiToken = await ensureAgentApiToken()
    await writeAgentDiscovery(agentApiToken, port, listenerId, startedAt)
  },
  removeDiscovery: removeAgentDiscovery,
  getAuthToken: () => agentApiToken,
  getWindow: () => mainWindow,
  confirmUserPresence: (prompt, phrase) => authController.confirmAgentApproval(prompt, phrase),
  resolveReleaseSelections: async (selections) => {
    const vaultKey = vaultSession.currentKey()
    if (!vaultKey) throw new Error('Not authenticated')
    return resolveAgentReleaseSelections(await readVault(vaultKey), selections)
  },
  saveExtensionCandidate: async (candidate, signal, authorizeCommit) => {
    const assertNotCancelled = () => {
      if (signal.aborted) throw new Error('Browser token save was cancelled')
    }
    assertNotCancelled()
    const vaultKey = vaultSession.currentKey()
    if (!vaultKey) throw new Error('Not authenticated')
    const committed = await updateVault(vaultKey, (vault) => {
      assertNotCancelled()
      const currentRevision = vaultRevisionFrom(vault, vaultRevision)
      const saved = addExtensionCandidateToVault(vault, candidate, {
        secretId: randomUUID(),
      })
      const snapshot = { ...saved.vault, revision: currentRevision + 1 }
      return {
        json: validateVaultSaveJson(JSON.stringify(snapshot)),
        result: { secretId: saved.secretId, revision: currentRevision + 1, snapshot },
      }
    }, { assertCurrent: () => { assertNotCancelled(); authorizeCommit?.() } })
    vaultRevision = committed.revision
    notifyVaultChanged({
      revision: committed.revision,
      data: redactVaultForRenderer(committed.snapshot),
      source: 'browser-extension',
    })
    return { secretId: committed.secretId }
  },
  recordAudit,
  authorizeCapability: async capability => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireCapabilityLease(capability)
  },
})

const auditFailureGuard = new AuditFailureGuard({
  lockVault: () => lockVault(true, 'audit-integrity-failure', false),
  notifyUser: () => {
    dialog.showErrorBox(
      'Vaultage locked to protect your vault',
      'The local audit history could not be authenticated or durably updated. '
        + 'Check available disk space and file permissions. If the error persists, preserve the audit files '
        + 'and restore from a trusted backup before continuing.',
    )
  },
  logFailure: (error, firstError) => {
    if (error === firstError) console.error('[audit] Audit subsystem entered fail-secure mode:', error)
    else console.error('[audit] Additional failure while fail-secure mode is active:', error)
  },
  logLockFailure: (error, firstError) => {
    console.error('[audit] Failed to complete the fail-secure vault lock:', error,
      'Original audit failure:', firstError)
  },
})

function recordAudit(type: AuditEventType, details: Record<string, unknown> = {}): void {
  const vaultKey = vaultSession.currentKey()
  const auditMacKey = vaultKey ? deriveAuditMacKey(vaultKey) : null
  if (!auditMacKey) {
    console.warn('[audit] skipped event without vault key:', type)
    return
  }
  auditQueue = auditQueue
    .catch(() => undefined)
    .then(async () => {
      // Events may have entered the queue before a preceding append exposed an
      // integrity failure. Suppress them once fail-secure mode is active; only
      // setup/unlock may probe whether the audit store has been repaired.
      if (!auditFailureGuard.shouldAttempt(type)) return
      try {
        await appendAuditEvent(AUDIT_LOG_FILE, type, details, auditMacKey)
        if (auditFailureGuard.markSucceeded(type)) {
          console.warn('[audit] Audit subsystem recovered after a verified unlock append')
        }
      } catch (err) {
        auditFailureGuard.markFailed(err)
      }
    })
    .finally(() => auditMacKey.fill(0))
}

async function flushAuditQueue(): Promise<void> {
  await auditQueue.catch(() => undefined)
}

function scheduleMutationReceiptAuditReconciliation(): void {
  receiptAuditReconciliationQueue = receiptAuditReconciliationQueue
    .catch(() => undefined)
    .then(async () => {
      const lease = vaultSession.leaseCurrentKey()
      if (!lease) return
      let auditMacKey: Buffer | null = null
      try {
        const vault = await readVault(lease.key)
        lease.assertCurrent()
        // Include every append queued by the just-completed unlock before
        // comparing durable receipts with authenticated retained history.
        await flushAuditQueue()
        lease.assertCurrent()
        auditMacKey = deriveAuditMacKey(lease.key)
        const verified = await readVerifiedAuditLog(AUDIT_LOG_FILE, auditMacKey)
        lease.assertCurrent()
        for (const entry of pendingAuditEntriesFromVaultMutationReceipts(vault, verified.events)) {
          recordAudit(entry.type, entry.details)
        }
      } catch (err) {
        if (err instanceof VaultSessionChangedError) return
        // A reconciliation read is itself an integrity check. Enter the same
        // fail-secure path as an append failure rather than trusting a partial
        // or unauthenticated history.
        auditFailureGuard.markFailed(err)
      } finally {
        auditMacKey?.fill(0)
        lease.release()
      }
    })
}

let providerRuntime!: ReturnType<typeof registerProviderIpc>

registerAuthIpc(mainWindowIpc, authController)
const projectPathCapabilities = new ProjectPathCapabilityStore()
registerVaultIpc(mainWindowIpc, {
  getVaultKey: () => vaultSession.currentKey(),
  readVault,
  beginSessionOperation: () => vaultSession.beginOperation(),
  recordSecretUsage: (secretId, usedAt) => usageBatcher.record(secretId, usedAt),
  decorateVaultSnapshot: (snapshot) => usageBatcher.decorateSnapshot(snapshot),
  getVaultRevision: () => vaultRevision,
  setVaultRevision: (revision) => { vaultRevision = revision },
  authorizeProviderMutation: (currentVault, command, context) => (
    providerRuntime.authorizeVerificationMutation(currentVault, command, context)
  ),
  authorizeCommercialMutation: async (currentVault, command) => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.authorizeVaultMutation(currentVault, command)
  },
  authorizeProjectPathMutation: (currentVault, command, context) => (
    authorizeProjectPathMutation(currentVault, command, context.webContentsId, projectPathCapabilities)
  ),
  onVaultChanged: notifyVaultChanged,
  lockVault,
  authController,
  recordAudit,
  quitApp: () => setTimeout(() => app.quit(), 0),
})
registerModeIpc(mainWindowIpc, {
  getMode: () => appMode,
  setMode: (mode) => {
    appMode = mode
    syncMenuBar()
  },
  getWindow: () => mainWindow,
  agentServer,
  recordAudit,
  authorizeServices: async () => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    await commercialRuntime.requireCapability('pro.services')
  },
})
registerAuditIpc(mainWindowIpc, {
  hasVaultKey: () => vaultSession.isUnlocked(),
  getAuditMacKey: () => {
    const key = vaultSession.currentKey()
    return key ? deriveAuditMacKey(key) : null
  },
  flushAuditQueue,
  recordAudit,
})

// ── IPC: providers ────────────────────────────────────────────────────────────
// Provider IPC is registered through the edition alias. Open source builds get
// a no-op registrar; private builds get the Services/provider surface.
providerRuntime = registerProviderIpc(mainWindowIpc, providerClient, recordAudit, {
  getVaultKey: () => vaultSession.currentKey(),
  leaseCurrentKey: () => vaultSession.leaseCurrentKey(),
  readVault,
  updateVault,
  setVaultRevision: (revision) => { vaultRevision = revision },
  onVaultChanged: ({ revision, data }) => notifyVaultChanged({ revision, data, source: 'provider' }),
  confirmProviderAction: (prompt) => authController.confirmAgentApproval(prompt),
  authorizeServices: async () => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireCapabilityLease('pro.services')
  },
})
registerProjectIpc(mainWindowIpc, {
  getVaultKey: () => vaultSession.currentKey(),
  getVaultRevision: () => vaultRevision,
  readVault,
  authController,
  recordAudit,
  acquireProjectScanLease: async (vault, path, projectId, replaceProjectId) => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireProjectScanLease(vault, path, projectId, replaceProjectId)
  },
  acquireProjectExportLease: async (vault, projectId) => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireProjectExportLease(vault, projectId)
  },
  confirmProjectExportSummary: async summary => {
    const options: MessageBoxOptions = {
      type: 'warning',
      title: 'Confirm plaintext .env export',
      message: `Export ${summary.projectName} / ${summary.environmentName} to .env?`,
      detail: [
        `Destination: ${summary.path}`,
        `Mappings (${summary.mappings.length}):`,
        ...summary.mappings,
        `Update .gitignore: ${summary.addToGitignore ? 'yes' : 'no'}`,
        `Replace existing .env: ${summary.overwriteExisting ? 'yes' : 'no'}`,
      ].join('\n'),
      buttons: ['Cancel', 'Export .env'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    return result.response === 1
  },
  pathCapabilities: projectPathCapabilities,
})
const extensionNativeHostRegistrar = createExtensionNativeHostRegistrar({
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
})
registerAgentIpc(mainWindowIpc, agentServer, {
  hasVaultKey: () => vaultSession.isUnlocked(),
  getAgentApiToken: async () => {
    if (!agentApiToken) agentApiToken = await ensureAgentApiToken()
    return agentApiToken
  },
  recordAudit,
  authorizeCapability: async capability => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireCapabilityLease(capability)
  },
  verifyExtensionNativeHost: async () => {
    if (!app.isPackaged) return
    await requireInstalledExtensionNativeHost(extensionNativeHostRegistrar)
  },
})
registerExtensionNativeHostIpc(mainWindowIpc, {
  getRegistrar: () => extensionNativeHostRegistrar,
  authorizeExtension: async () => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireCapabilityLease('pro.extension')
  },
  confirmAction: confirmExtensionNativeHostAction,
})
registerPlatformIpc(mainWindowIpc)
registerMenuPanelIpc(menuPanelIpc, {
  appName: APP_DISPLAY_NAME,
  openCoreBuild: OPEN_CORE_BUILD,
  getVaultKey: () => vaultSession.currentKey(),
  beginSessionOperation: () => vaultSession.beginOperation(),
  recordSecretUsage: (secretId, usedAt) => usageBatcher.record(secretId, usedAt),
  getVaultRevision: () => vaultRevision,
  setVaultRevision: (revision) => { vaultRevision = revision },
  readVault,
  pendingCount: () => agentServer.pendingCount(),
  isAgentListening: () => isAgentListening(),
  agentPort: () => agentServer.configuredPort(),
  isBrowserEnabled: () => agentServer.isExtensionEnabled(),
  showMainWindow,
  navigateMainWindow,
  closePanel: () => menuPanelWindow?.hide(),
  lockVault: () => lockVault(true, 'menu-bar-panel'),
  startAgent: startAgentListeningFromMenu,
  stopAgent: stopAgentListeningFromMenu,
  startBrowser: startBrowserExtensionFromMenu,
  stopBrowser: stopBrowserExtensionFromMenu,
  copyAgentInstructions: copyAgentInstructionsFromMenu,
  quitApp: () => app.quit(),
  authController,
  recordAudit,
  notifyVaultChanged,
})

// ── Window ────────────────────────────────────────────────────────────────────

async function lockVault(
  notifyRenderer = true,
  reason = 'auto-lock',
  recordLockAudit = true,
): Promise<void> {
  commercialRuntime?.suspend('Local vault locked')
  projectPathCapabilities.revokeAll()
  providerRuntime.clearSessionAuthorizations()
  const wasUnlocked = vaultSession.isUnlocked()
  await vaultSession.invalidate()
  disableSecureInput()
  agentServer.setApiEnabledState(false)
  agentServer.setExtensionEnabledState(false)
  agentServer.cancelPendingRequests('Vaultage locked')
  void agentServer.syncListenerState()
  if (wasUnlocked && recordLockAudit) recordAudit('vault.lock', { reason })
  if (wasUnlocked) {
    await usageBatcher.flush().catch((err) => {
      // Usage metadata is best-effort and remains queued with an idempotency
      // marker for the next unlock. A failed counter flush must never prevent
      // the security boundary from locking the vault.
      console.error('[vault-usage] Could not flush before lock:', err)
    })
  }
  vaultRevision = 0
  syncWindowContentProtection()
  syncMenuBar()
  if (notifyRenderer) mainWindow?.webContents.send(vaultIpcEvents.autoLock)
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
  return usageBatcher.decorateSnapshot(redactVaultForRenderer(hydrated))
}

function syncAgentApiPortFromVault(vault: unknown): void {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) return
  const preferences = (vault as { preferences?: unknown }).preferences
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return
  const rawPort = (preferences as { agentApiPort?: unknown }).agentApiPort
  if (rawPort === undefined) return
  try {
    const port = validateAgentApiPort(rawPort)
    void agentServer.configurePort(port).catch(err => {
      console.warn('[vault-mode] Could not publish Agent port discovery:', err instanceof Error ? err.message : String(err))
    })
  } catch (err) {
    console.warn('[vault-mode] Ignoring invalid saved local API port:', err instanceof Error ? err.message : String(err))
  }
}

function createWindow(): void {
  mainWindow = createMainWindow(() => {
    mainWindow = null
    syncMenuBar()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    void flushExtensionHandoff()
  })
  syncWindowContentProtection()
  syncMenuBar()
}

function createPanelWindow(): BrowserWindow {
  if (menuPanelWindow && !menuPanelWindow.isDestroyed()) return menuPanelWindow
  menuPanelWindow = createMenuPanelWindow(() => {
    menuPanelWindow = null
  })
  return menuPanelWindow
}

function showMainWindow(): void {
  if (!mainWindow) createWindow()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function navigateMainWindow(intent: MainWindowNavigationIntent): void {
  showMainWindow()
  const target = mainWindow?.webContents
  if (!target) return
  const send = () => target.send(menuPanelIpcEvents.navigateMainWindow, intent)
  if (target.isLoadingMainFrame()) target.once('did-finish-load', send)
  else send()
}

function isAgentListening(): boolean {
  return appMode === 'agent' && agentServer.isApiEnabled()
}

function toggleMenuPanel(): void {
  const panel = createPanelWindow()
  if (panel.isVisible()) {
    panel.hide()
    return
  }
  positionMenuPanel(panel)
  panel.show()
  panel.focus()
}

function positionMenuPanel(panel: BrowserWindow): void {
  const trayBounds = menuBar?.bounds()
  const panelBounds = panel.getBounds()
  if (!trayBounds) {
    const display = screen.getPrimaryDisplay()
    panel.setPosition(
      display.workArea.x + display.workArea.width - panelBounds.width - 16,
      display.workArea.y + 28,
      false,
    )
    return
  }

  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  })
  const workArea = display.workArea
  const x = clamp(
    Math.round(trayBounds.x + trayBounds.width / 2 - panelBounds.width / 2),
    workArea.x + 8,
    workArea.x + workArea.width - panelBounds.width - 8,
  )
  const yBelow = Math.round(trayBounds.y + trayBounds.height + 8)
  const y = yBelow + panelBounds.height <= workArea.y + workArea.height
    ? yBelow
    : Math.max(workArea.y + 8, Math.round(trayBounds.y - panelBounds.height - 8))
  panel.setPosition(x, y, false)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function startAgentListeningFromMenu(): Promise<void> {
  if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
  await commercialRuntime.requireCapability('pro.agent')
  if (!vaultSession.isUnlocked()) {
    showMainWindow()
    return
  }
  if (appMode !== 'agent') {
    const previousMode = appMode
    appMode = 'agent'
    try {
      mainWindow?.webContents.send(modeIpcEvents.changed, appMode)
      recordAudit('mode.change', { from: previousMode, to: appMode, source: 'menu-bar' })
    } catch (err) {
      appMode = previousMode
      throw err
    } finally {
      syncMenuBar()
    }
  }

  const result = agentServer.handleSetApiEnabled(true)
  if (!result.success) throw new Error(result.error ?? 'Could not start Agent listening')
  await agentServer.syncListenerState()
}

function stopAgentListeningFromMenu(): void {
  const result = agentServer.handleSetApiEnabled(false)
  if (!result.success) throw new Error(result.error ?? 'Could not stop Agent listening')
}

async function startBrowserExtensionFromMenu(): Promise<void> {
  if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
  await commercialRuntime.requireCapability('pro.extension')
  if (!vaultSession.isUnlocked()) {
    showMainWindow()
    return
  }
  if (app.isPackaged) await requireInstalledExtensionNativeHost(extensionNativeHostRegistrar)
  if (!agentApiToken) agentApiToken = await ensureAgentApiToken()
  const result = await agentServer.handleSetExtensionEnabled(true)
  if (!result.success) throw new Error(result.error ?? 'Could not enable browser extension')
}

async function stopBrowserExtensionFromMenu(): Promise<void> {
  const result = await agentServer.handleSetExtensionEnabled(false)
  if (!result.success) throw new Error(result.error ?? 'Could not disable browser extension')
}

async function copyAgentInstructionsFromMenu(): Promise<void> {
  if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
  await commercialRuntime.requireCapability('pro.agent')
  if (!vaultSession.isUnlocked()) {
    showMainWindow()
    return
  }
  if (!agentApiToken) agentApiToken = await ensureAgentApiToken()
  writeSensitiveClipboardText(agentInstructionsSnippet(agentApiToken, agentServer.configuredPort()))
  recordAudit('agent.instructions.copied', {
    source: 'menu-bar',
    port: agentServer.configuredPort(),
    clearAfterMs: AGENT_INSTRUCTIONS_CLIPBOARD_CLEAR_MS,
  })
}

function writeSensitiveClipboardText(value: string): void {
  clipboard.writeText(value)
  const timer = setTimeout(() => {
    if (clipboard.readText() === value) clipboard.writeText('')
  }, AGENT_INSTRUCTIONS_CLIPBOARD_CLEAR_MS)
  timer.unref?.()
}

function initializeMenuBar(): void {
  menuBar = new MenuBarController({
    iconPath: iconPath(),
    getState: () => ({
      appName: APP_DISPLAY_NAME,
      unlocked: vaultSession.isUnlocked(),
      mode: appMode,
      agentApiEnabled: agentServer.isApiEnabled(),
      pendingCount: agentServer.pendingCount(),
      port: agentServer.configuredPort(),
      openCoreBuild: OPEN_CORE_BUILD,
    }),
    actions: {
      open: showMainWindow,
      unlock: showMainWindow,
      lock: () => lockVault(true, 'menu-bar'),
      quickSearch: toggleMenuPanel,
      startAgent: startAgentListeningFromMenu,
      stopAgent: stopAgentListeningFromMenu,
      copyAgentInstructions: copyAgentInstructionsFromMenu,
      openAgentDashboard: showMainWindow,
      settings: showMainWindow,
      quit: () => app.quit(),
    },
  })
  menuBar.initialize()
}

async function receiveExtensionHandoff(handoff: ExtensionHandoff | null): Promise<void> {
  handoff = await authorizeCommercialExtensionHandoff(commercialRuntime, handoff)
  if (!handoff) return
  pendingExtensionHandoff = handoff
  if (mainWindow) {
    showMainWindow()
    flushExtensionHandoff()
  }
  recordAudit('extension.handoff.received', {
    source: handoff.source,
    mode: handoff.mode,
    provider: handoff.provider ?? null,
    host: handoff.host ?? null,
    page: handoff.page ?? null,
  })
}

function receiveExtensionHandoffUrl(rawUrl: string): void {
  if (!agentApiToken) {
    pendingExtensionHandoffUrls = [...pendingExtensionHandoffUrls, rawUrl].slice(-8)
    return
  }
  void receiveExtensionHandoff(parseExtensionHandoffUrl(rawUrl, agentApiToken))
}

function flushExtensionHandoffUrls(): void {
  if (!agentApiToken || pendingExtensionHandoffUrls.length === 0) return
  const urls = pendingExtensionHandoffUrls
  pendingExtensionHandoffUrls = []
  for (const rawUrl of urls) void receiveExtensionHandoff(parseExtensionHandoffUrl(rawUrl, agentApiToken))
}

async function flushExtensionHandoff(): Promise<void> {
  if (!mainWindow || !pendingExtensionHandoff) return
  const authorized = await authorizeCommercialExtensionHandoff(commercialRuntime, pendingExtensionHandoff)
  if (!authorized) {
    pendingExtensionHandoff = null
    return
  }
  const handoff = pendingExtensionHandoff
  pendingExtensionHandoff = null
  sendExtensionHandoff(mainWindow, handoff)
}

app.on('open-url', (event, rawUrl) => {
  event.preventDefault()
  receiveExtensionHandoffUrl(rawUrl)
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setName(APP_DISPLAY_NAME)
  commercialRuntime = await installCommercialRuntime({
    ipcMain: mainWindowIpc,
    userDataPath: app.getPath('userData'),
    safeStorage,
    randomId: randomUUID,
    fetch: globalThis.fetch,
    openExternal: async url => { await shell.openExternal(url) },
    showSaveDialog: async () => {
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            title: 'Export Vaultage account data',
            defaultPath: 'vaultage-account-data.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Export Vaultage account data',
            defaultPath: 'vaultage-account-data.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
          })
      return { canceled: result.canceled, ...(result.filePath ? { filePath: result.filePath } : {}) }
    },
    sendToRenderer: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
    },
    appVersion: app.getVersion(),
    deviceDisplayName: process.platform === 'darwin' ? 'Vaultage on macOS' : `Vaultage on ${process.platform}`,
    onCapabilitiesLost: async capabilities => {
      await agentServer.handleCapabilitiesLost(capabilities)
      if (capabilities.includes('pro.services') && appMode === 'broker') {
        const previousMode = appMode
        appMode = 'local'
        mainWindow?.webContents.send(modeIpcEvents.changed, appMode)
        recordAudit('mode.change', {
          from: previousMode,
          to: appMode,
          reason: 'commercial-capability-lost',
        })
        syncMenuBar()
      }
    },
  })
  registerExtensionProtocol()
  agentApiToken = await ensureAgentApiToken()
  await removeAgentDiscovery()
  await receiveExtensionHandoff(findExtensionHandoffArg(process.argv, agentApiToken))
  flushExtensionHandoffUrls()
  installRendererCsp(session.defaultSession, { allowDevelopmentWebSockets: !app.isPackaged })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  const menuPanelSession = session.fromPartition(MENU_PANEL_PARTITION, { cache: false })
  installRendererCsp(menuPanelSession, { allowDevelopmentWebSockets: !app.isPackaged })
  menuPanelSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  menuPanelSession.setPermissionCheckHandler(() => false)
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath()))
  }
  initializeMenuBar()
  createWindow()
  void notifyExtensionNativeHostLaunchIssue().catch(() => {
    console.error('[extension-native-host] Startup verification notification failed safely')
  })
  installAutoUpdateChecks()
  idleAutoLock = new IdleAutoLockController({
    isUnlocked: () => vaultSession.isUnlocked(),
    getSystemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    lock: (reason) => lockVault(true, reason),
  })
  idleAutoLock.start()
  // Server only starts when mode is explicitly set to 'agent'
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
    if (vaultSession.isUnlocked()) void commercialRuntime?.resume()
  })
  app.on('browser-window-focus', () => {
    if (vaultSession.isUnlocked()) void commercialRuntime?.resume()
  })
  // Lock vault on system sleep or screen lock
  powerMonitor.on('suspend',     () => { void lockVault(true, 'system-suspend') })
  powerMonitor.on('lock-screen', () => { void lockVault(true, 'screen-lock') })
})

async function notifyExtensionNativeHostLaunchIssue(): Promise<void> {
  if (!app.isPackaged) return
  const issue = await extensionNativeHostLaunchIssue(extensionNativeHostRegistrar)
  if (!issue) return
  const options: MessageBoxOptions = {
    type: 'warning',
    title: 'Browser extension host needs attention',
    message: 'Browser extension host needs attention',
    detail: `${issue} Open Vaultage Settings to review the Chrome and Edge registration states.`,
    buttons: ['Open Settings', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  if (result.response === 0) navigateMainWindow('settings')
}

app.on('second-instance', (_event, argv) => {
  void receiveExtensionHandoff(findExtensionHandoffArg(argv, agentApiToken))
  showMainWindow()
})

app.on('window-all-closed', () => {
  void lockVault(false, 'window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  idleAutoLock?.stop()
  menuBar?.destroy()
  disableSecureInput()
  commercialRuntime?.dispose()
  if (quitPrepared) return
  event.preventDefault()
  if (quitPreparing) return
  quitPreparing = true
  void (async () => {
    await lockVault(false, 'app-quit')
    await flushAuditQueue()
    quitPrepared = true
    app.quit()
  })().catch((err) => {
    console.error('[shutdown] Failed to finalize vault shutdown:', err)
    quitPrepared = true
    app.quit()
  })
})

async function confirmExtensionNativeHostAction(action: ExtensionNativeHostAction, browser: 'chrome' | 'edge'): Promise<boolean> {
  const browserName = browser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'
  const copy = action === 'install'
    ? { title: `Install ${browserName} extension host?`, detail: `Vaultage will register its local native-messaging host for ${browserName}.` }
    : action === 'repair'
      ? { title: `Repair ${browserName} extension host?`, detail: 'Vaultage will replace only a manifest proven by its private installation receipt. Unrelated manifests are never changed.' }
      : { title: `Remove ${browserName} extension host?`, detail: `Vaultage will remove only its recognized ${browserName} native-host manifest. Removal remains available after a trial or subscription ends.` }
  const options: MessageBoxOptions = {
    type: action === 'remove' ? 'warning' : 'question',
    title: copy.title,
    message: copy.title,
    detail: copy.detail,
    buttons: [action === 'remove' ? 'Remove' : action === 'repair' ? 'Repair' : 'Install', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}
