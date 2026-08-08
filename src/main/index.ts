import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, nativeImage, safeStorage, screen, session, shell, type MessageBoxOptions, type Session } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'
import { appendAuditEvent, deriveAuditMacKey, readVerifiedAuditLog, type AuditEventType } from './audit'
import { AuditFailureGuard } from './auditFailureGuard'
import { runGracefulShutdown } from './gracefulShutdown'
import { registerAgentComposition } from '#agent-composition'
import {
  registerExtensionProtocol,
  sendExtensionHandoff,
  type ExtensionHandoff,
} from '#extension-handoff'
import { collectHostedBillingReturnArgs, parseHostedBillingReturnUrl } from './billingReturnHandoff'
import { AuthController } from './auth'
import { installRendererCsp } from './contentSecurityPolicy'
import { shouldUseWindowContentProtection } from './contentProtectionPolicy'
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
import { createRailwayProviderRuntime, registerProviderIpc } from '#provider-ipc'
import { ProviderWorkerClient } from '#provider-worker-client'
import { ProviderRecoveryStore } from '#provider-recovery'
import { IS_MAC, keychainRemove, keychainRetrieve, keychainStore } from './keychain'
import {
  createE2EHeadlessPolicy,
  installE2EHeadlessInspection,
} from './e2eHeadlessPolicy'
import { installE2EClipboardPolicy } from './e2eClipboardPolicy'
import {
  createE2ENetworkPolicy,
  installRendererNetworkDenial,
} from './e2eNetworkPolicy'
import { disableSecureInput } from './secureInput'
import { createMainWindow, createMenuPanelWindow, iconPath, MENU_PANEL_PARTITION } from './window'
import { MenuBarController } from './menuBar'
import {
  AUDIT_LOG_FILE,
  VAULT_DIR,
  commitAuthCredentials,
  commitAuthAndRecoveryCredentials,
  commitRecoveryEnvelope,
  commitRestoredVaultState,
  createVaultState,
  ensureVaultDir,
  getAuthStateStatus,
  readCredentials,
  readRecoveryCredentials,
  readRecoveryEnvelope,
  readVault,
  readVaultById,
  readVaultCollection,
  updateVault,
  validateVaultBackupSnapshot,
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
const SCREENSHOT_REVIEW_BUILD = typeof __VAULTAGE_SCREENSHOT_REVIEW_BUILD__ !== 'undefined'
  && __VAULTAGE_SCREENSHOT_REVIEW_BUILD__
const APP_IDENTITY = {
  name: 'Vaultage Community',
  keychainNamespace: 'community',
  bundleId: 'xyz.arcalab.vault-oc',
} as const
const APP_DISPLAY_NAME = APP_IDENTITY.name
const USER_FACING_APP_NAME = OPEN_CORE_BUILD ? 'Vaultage Community' : 'Vaultage'
const e2eHeadlessPolicy = createE2EHeadlessPolicy(
  app.isPackaged,
  process.env['VAULTAGE_E2E_HEADLESS'],
)
const e2eNetworkPolicy = createE2ENetworkPolicy(e2eHeadlessPolicy.active)
const e2eClipboardPolicy = installE2EClipboardPolicy(e2eHeadlessPolicy.active, clipboard)
const protectedE2ESessions = new WeakSet<Session>()
installE2EHeadlessInspection(globalThis, e2eHeadlessPolicy, () => ({
  clipboard: e2eClipboardPolicy.snapshot(),
  network: e2eNetworkPolicy.snapshot(),
  visibility: e2eHeadlessPolicy.snapshot(),
}))
app.on('session-created', createdSession => {
  protectE2ERendererSession(createdSession)
})
if (e2eHeadlessPolicy.active && process.platform === 'darwin') {
  void app.dock?.hide()
}
app.setName(APP_DISPLAY_NAME)
const authKeychain = {
  isMac: IS_MAC,
  retrieve: keychainRetrieve,
  store: keychainStore,
  remove: keychainRemove,
}
const commercialSafeStorage = safeStorage
const providerClient = new ProviderWorkerClient()
const providerRecovery = new ProviderRecoveryStore()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
let idleAutoLock: IdleAutoLockController | null = null
let vaultRevision = 0
let pendingExtensionHandoff: ExtensionHandoff | null = null
let pendingExtensionHandoffUrls: string[] = []
let pendingHostedBillingReturnUrls = [...collectHostedBillingReturnArgs(process.argv)]
let menuBar: MenuBarController | null = null
let menuPanelWindow: BrowserWindow | null = null
let quitPreparing = false
let quitPrepared = false
let commercialRuntime: CommercialRuntimeAccess | null = null
const AGENT_INSTRUCTIONS_CLIPBOARD_CLEAR_MS = 30_000

function protectE2ERendererSession(targetSession: Session): void {
  if (!e2eNetworkPolicy.active || protectedE2ESessions.has(targetSession)) return
  installRendererNetworkDenial(
    (filter, listener) => targetSession.webRequest.onBeforeRequest(filter, listener),
    e2eNetworkPolicy,
  )
  protectedE2ESessions.add(targetSession)
}

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
  return shouldUseWindowContentProtection({
    isPackaged: app.isPackaged,
    screenshotReviewBuild: SCREENSHOT_REVIEW_BUILD,
    allowDevelopmentScreenshots:
      process.env['VAULTAGE_DISABLE_CONTENT_PROTECTION'] === '1',
    enableContentProtectionInDevelopment:
      process.env['VAULTAGE_ENABLE_CONTENT_PROTECTION'] === '1',
  })
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
  const vaultId = typeof change.vaultId === 'string'
    ? change.vaultId
    : vaultIdFromSnapshot(change.data)
  if (!vaultId) {
    console.error('[vault] Refused to publish an unscoped vault-change event')
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(vaultIpcEvents.changed, {
      ...change,
      vaultId,
      data: usageBatcher.decorateSnapshot(change.data),
    })
  }
  syncMenuBar()
}

function vaultIdFromSnapshot(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = (value as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null
  const id = (root as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
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
        agentComposition.rotateSession()
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
  keychain: authKeychain,
  storage: {
    ensureVaultDir,
    getAuthStateStatus,
    readCredentials,
    readRecoveryCredentials,
    readVault,
    validateVaultBackupSnapshot,
    createVaultState,
    commitAuthCredentials,
    readRecoveryEnvelope,
    commitRecoveryEnvelope,
    commitAuthAndRecoveryCredentials,
    commitRestoredVaultState: async (snapshot, key, assertCurrent, replacement) => {
      await agentComposition.clearStoredAccess()
      await commitRestoredVaultState(snapshot, key, assertCurrent, replacement)
    },
  },
  randomId: randomUUID,
  recordAudit,
})

const agentComposition = registerAgentComposition({
  ipcMain: mainWindowIpc,
  applicationIdentity: `${APP_IDENTITY.bundleId}:${APP_IDENTITY.keychainNamespace}`,
  pairingDirectory: VAULT_DIR, onPairingPendingChanged: syncWindowContentProtection,
  getMode: () => appMode, hasVaultKey: () => vaultSession.isUnlocked(),
  beginSessionOperation: () => vaultSession.beginOperation(),
  leaseVaultKey: () => vaultSession.leaseCurrentKey(),
  readVault,
  updateVault,
  getVaultRevision: () => vaultRevision,
  setVaultRevision: revision => { vaultRevision = revision },
  onVaultChanged: ({ revision, snapshot }) => notifyVaultChanged({
    revision,
    data: redactVaultForRenderer(snapshot),
    source: 'agent',
  }),
  shouldProtectContent: shouldUseContentProtection,
  onStateChanged: syncMenuBar,
  getWindow: () => mainWindow,
  confirmUserPresence: (prompt, phrase) => authController.confirmAgentApproval(prompt, phrase),
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
  recordAuditDurable,
  authorizeCapability: async capability => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireCapabilityLease(capability)
  },
  verifyExtensionNativeHost: async () => {
    if (!app.isPackaged) return
    await requireInstalledExtensionNativeHost(extensionNativeHostRegistrar)
  },
  providerWorkerClient: providerClient,
  providerRecovery,
  openExternal: async url => { await shell.openExternal(url) },
})
const agentServer = agentComposition.server

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
        auditFailureGuard.markFailed(err instanceof Error ? err : new Error(String(err)))
      }
    })
    .finally(() => auditMacKey.fill(0))
}

async function recordAuditDurable(
  type: AuditEventType,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (auditFailureGuard.isBlocked) throw new Error('Audit integrity guard is blocking secret release')
  if (!vaultSession.isUnlocked()) throw new Error('Vault locked before audit evidence could be recorded')
  recordAudit(type, details)
  await flushAuditQueue()
  if (auditFailureGuard.isBlocked) throw new Error('Audit event could not be durably recorded')
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
        const collection = await readVaultCollection(lease.key)
        lease.assertCurrent()
        // Include every append queued by the just-completed unlock before
        // comparing durable receipts with authenticated retained history.
        await flushAuditQueue()
        lease.assertCurrent()
        auditMacKey = deriveAuditMacKey(lease.key)
        const verified = await readVerifiedAuditLog(AUDIT_LOG_FILE, auditMacKey)
        lease.assertCurrent()
        // Every vault owns a separate receipt namespace. Reading the complete
        // collection (including archives) repairs an inactive receipt that
        // was committed before the user switched away and archived its vault.
        for (const item of collection.vaults) {
          const vault = item.id === collection.activeVaultId
            ? await readVault(lease.key)
            : await readVaultById(lease.key, item.id, { includeArchived: true })
          lease.assertCurrent()
          for (const entry of pendingAuditEntriesFromVaultMutationReceipts(vault, verified.events, item.id)) {
            recordAudit(entry.type, entry.details)
          }
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
  beforeVaultScopeChange: async () => {
    try {
      await usageBatcher.flush()
    } catch (error) {
      console.error('[vault-usage] Could not flush before active-vault change:', error)
      usageBatcher.discard('active-vault-change-flush-failed')
    }
    if (!vaultSession.rotateScope()) throw new Error('Not authenticated')
    projectPathCapabilities.revokeAll()
    providerRuntime.clearSessionAuthorizations()
    agentComposition.rotateSession()
    agentServer.cancelPendingRequests('Active vault changed')
    menuPanelWindow?.hide()
  },
  onVaultChanged: notifyVaultChanged,
  lockVault,
  authController,
  recordAudit,
  recordAuditDurable,
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
  beginSessionOperation: () => vaultSession.beginOperation(),
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
  recordAuditDurable,
  recoveryStore: providerRecovery,
  authorizeServices: async () => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireCapabilityLease('pro.services')
  },
  railway: createRailwayProviderRuntime(providerClient, async url => { await shell.openExternal(url) }),
})
registerProjectIpc(mainWindowIpc, {
  getVaultKey: () => vaultSession.currentKey(),
  getVaultRevision: () => vaultRevision,
  readVault,
  beginSessionOperation: () => vaultSession.beginOperation(),
  authController,
  recordAudit,
  recordAuditDurable,
  acquireProjectScanLease: async (vault, path, projectId) => {
    if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
    return commercialRuntime.acquireProjectScanLease(vault, path, projectId)
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
  appName: USER_FACING_APP_NAME,
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
  hasBrowserCapability: async () => await commercialRuntime?.hasCapability('pro.extension') ?? false,
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
  recordAuditDurable,
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
  agentComposition.rotateSession()
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
  void agentComposition.configurePort(rawPort).then(result => {
    if (result.success === false) console.warn('[vault-mode] Ignoring invalid saved local API port:', result.error)
  }).catch(err => {
    console.warn('[vault-mode] Could not publish Agent port discovery:', err instanceof Error ? err.message : String(err))
  })
}

function createWindow(): void {
  mainWindow = createMainWindow(() => {
    agentComposition.clearCredentialDeposits('vault_locked')
    mainWindow = null
    syncMenuBar()
  }, e2eHeadlessPolicy)
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
  }, e2eHeadlessPolicy)
  return menuPanelWindow
}

function showMainWindow(): void {
  if (!e2eHeadlessPolicy.allow('show')) return
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
  if (!e2eHeadlessPolicy.allow('menuPanel')) return
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
  if (result.success === false) throw new Error(result.error ?? 'Could not start Agent listening')
  await agentServer.syncListenerState()
}

function stopAgentListeningFromMenu(): void {
  const result = agentServer.handleSetApiEnabled(false)
  if (result.success === false) throw new Error(result.error ?? 'Could not stop Agent listening')
}

async function startBrowserExtensionFromMenu(): Promise<void> {
  if (!commercialRuntime) throw new Error('Commercial policy is still initializing')
  await commercialRuntime.requireCapability('pro.extension')
  if (!vaultSession.isUnlocked()) {
    showMainWindow()
    return
  }
  if (app.isPackaged) await requireInstalledExtensionNativeHost(extensionNativeHostRegistrar)
  await agentComposition.ensureReady()
  const result = await agentServer.handleSetExtensionEnabled(true)
  if (result.success === false) throw new Error(result.error ?? 'Could not enable browser extension')
}

async function stopBrowserExtensionFromMenu(): Promise<void> {
  const result = await agentServer.handleSetExtensionEnabled(false)
  if (result.success === false) throw new Error(result.error ?? 'Could not disable browser extension')
}

async function copyAgentInstructionsFromMenu(): Promise<void> {
  if (!vaultSession.isUnlocked()) {
    showMainWindow()
    return
  }
  const operation = vaultSession.beginOperation()
  if (!operation) throw new Error('Not authenticated')
  let clipboardFingerprint: string | null = null
  try {
    const snippet = await agentComposition.instructionsSnippet()
    operation.assertCurrent()
    clipboardFingerprint = writeSensitiveClipboardText(snippet)
    await recordAuditDurable('agent.instructions.copied', {
      source: 'menu-bar',
      port: agentServer.configuredPort(),
      clearAfterMs: AGENT_INSTRUCTIONS_CLIPBOARD_CLEAR_MS,
    })
    operation.assertCurrent()
  } catch (error) {
    clearOwnedSensitiveClipboardText(clipboardFingerprint)
    throw error
  } finally {
    operation.release()
  }
}

function writeSensitiveClipboardText(value: string): string {
  const fingerprint = sensitiveClipboardFingerprint(value)
  clipboard.writeText(value)
  const timer = setTimeout(() => {
    if (sensitiveClipboardFingerprint(clipboard.readText()) === fingerprint) clipboard.writeText('')
  }, AGENT_INSTRUCTIONS_CLIPBOARD_CLEAR_MS)
  timer.unref?.()
  return fingerprint
}

function clearOwnedSensitiveClipboardText(fingerprint: string | null): void {
  if (fingerprint && sensitiveClipboardFingerprint(clipboard.readText()) === fingerprint) clipboard.writeText('')
}

function sensitiveClipboardFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function initializeMenuBar(): void {
  e2eHeadlessPolicy.recordCreated('tray')
  menuBar = new MenuBarController({
    iconPath: iconPath(),
    getState: () => ({
      appName: USER_FACING_APP_NAME,
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
  if (!agentComposition.isReady()) {
    pendingExtensionHandoffUrls = [...pendingExtensionHandoffUrls, rawUrl].slice(-8)
    return
  }
  const handoff = agentComposition.parseHandoffUrl(rawUrl)
  if (handoff) void receiveExtensionHandoff(handoff)
}

function flushExtensionHandoffUrls(): void {
  if (!agentComposition.isReady() || pendingExtensionHandoffUrls.length === 0) return
  const urls = pendingExtensionHandoffUrls
  pendingExtensionHandoffUrls = []
  for (const rawUrl of urls) void receiveExtensionHandoff(agentComposition.parseHandoffUrl(rawUrl))
}

function receiveHostedBillingReturnUrl(rawUrl: string): void {
  const billingReturn = parseHostedBillingReturnUrl(rawUrl)
  if (!billingReturn) return
  if (!commercialRuntime) {
    pendingHostedBillingReturnUrls = [...pendingHostedBillingReturnUrls, rawUrl].slice(-4)
    return
  }
  void commercialRuntime.observeHostedBillingReturn(billingReturn).then(() => {
    showMainWindow()
  }).catch(() => undefined)
}

function flushHostedBillingReturnUrls(): void {
  if (!commercialRuntime || pendingHostedBillingReturnUrls.length === 0) return
  const urls = pendingHostedBillingReturnUrls
  pendingHostedBillingReturnUrls = []
  for (const rawUrl of urls) receiveHostedBillingReturnUrl(rawUrl)
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
  if (!e2eHeadlessPolicy.allow('openUrl')) return
  receiveHostedBillingReturnUrl(rawUrl)
  receiveExtensionHandoffUrl(rawUrl)
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setName(APP_DISPLAY_NAME)
  commercialRuntime = await installCommercialRuntime({
    ipcMain: mainWindowIpc,
    userDataPath: app.getPath('userData'),
    safeStorage: commercialSafeStorage,
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
  flushHostedBillingReturnUrls()
  await agentComposition.initialize()
  await receiveExtensionHandoff(agentComposition.findHandoffArg(process.argv))
  flushExtensionHandoffUrls()
  protectE2ERendererSession(session.defaultSession)
  installRendererCsp(session.defaultSession, { allowDevelopmentWebSockets: !app.isPackaged })
  session.defaultSession.on('will-download', event => event.preventDefault())
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  if (!e2eHeadlessPolicy.active) {
    const menuPanelSession = session.fromPartition(MENU_PANEL_PARTITION, { cache: false })
    installRendererCsp(menuPanelSession, { allowDevelopmentWebSockets: !app.isPackaged })
    menuPanelSession.on('will-download', event => event.preventDefault())
    menuPanelSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    menuPanelSession.setPermissionCheckHandler(() => false)
  }
  if (process.platform === 'darwin') {
    if (e2eHeadlessPolicy.active) await app.dock?.hide()
    else app.dock?.setIcon(nativeImage.createFromPath(iconPath()))
  }
  if (!e2eHeadlessPolicy.active) initializeMenuBar()
  createWindow()
  if (!e2eHeadlessPolicy.active) {
    void notifyExtensionNativeHostLaunchIssue().catch(() => {
      console.error('[extension-native-host] Startup verification notification failed safely')
    })
  }
  idleAutoLock = new IdleAutoLockController({
    isUnlocked: () => vaultSession.isUnlocked(),
    getSystemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    lock: (reason) => lockVault(true, reason),
  })
  idleAutoLock.start()
  // Server only starts when mode is explicitly set to 'agent'
  app.on('activate', () => {
    if (!e2eHeadlessPolicy.allow('activate')) return
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
  if (!e2eHeadlessPolicy.allow('secondInstance')) return
  for (const rawUrl of argv) receiveHostedBillingReturnUrl(rawUrl)
  void receiveExtensionHandoff(agentComposition.findHandoffArg(argv))
  showMainWindow()
})

app.on('window-all-closed', () => {
  void lockVault(false, 'window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitPrepared) return
  event.preventDefault()
  if (quitPreparing) return
  quitPreparing = true
  idleAutoLock?.stop()
  menuBar?.destroy()
  disableSecureInput()
  void runGracefulShutdown({
    cleanup: async () => {
      await lockVault(false, 'app-quit')
      agentComposition.shutdown()
      await flushAuditQueue()
    },
    dispose: () => commercialRuntime?.dispose(),
    exit: () => {
      quitPrepared = true
      app.exit(0)
    },
    reportFailure: (error) => console.error('[shutdown] Cleanup failed:', error.name),
    timeoutMs: 5_000,
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
