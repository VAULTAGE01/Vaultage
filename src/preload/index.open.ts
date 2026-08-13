import { contextBridge, ipcRenderer } from 'electron'
import { auditIpcContracts, type AuditIpcApi } from '../shared/auditIpcContracts'
import { authIpcContracts, type AuthIpcApi } from '../shared/authIpcContracts'
import { modeIpcContracts, modeIpcEvents, type ModeIpcApi } from '../shared/modeIpcContracts'
import { menuPanelIpcContracts, type MenuPanelIpcApi } from '../shared/menuPanelIpcContracts'
import { platformIpcContracts, type PlatformIpcApi } from '../shared/platformIpcContracts'
import { projectIpcContracts, type ProjectIpcApi } from '../shared/projectIpcContracts'
import { vaultIpcContracts, vaultIpcEvents, type VaultIpcApi } from '../shared/vaultIpcContracts'

const auditIpc = auditIpcContracts
const authIpc = authIpcContracts
const modeIpc = modeIpcContracts
const menuPanelIpc = menuPanelIpcContracts
const platformIpc = platformIpcContracts
const projectIpc = projectIpcContracts
const vaultIpc = vaultIpcContracts

const authApi: AuthIpcApi = {
  status:         () => ipcRenderer.invoke(authIpc.status.channel),
  setup:          (password) => ipcRenderer.invoke(authIpc.setup.channel, password),
  touchID:        () => ipcRenderer.invoke(authIpc.touchID.channel),
  confirmTouchID: (prompt) => ipcRenderer.invoke(authIpc.confirm.channel, { prompt }),
  password:       (password) => ipcRenderer.invoke(authIpc.password.channel, password),
  changePassword: (payload) => ipcRenderer.invoke(authIpc.changePassword.channel, payload),
  recoveryStatus: () => ipcRenderer.invoke(authIpc.recoveryStatus.channel),
  createRecoveryKit: (payload) => ipcRenderer.invoke(authIpc.createRecoveryKit.channel, payload),
  verifyRecoveryKit: (payload) => ipcRenderer.invoke(authIpc.verifyRecoveryKit.channel, payload),
  saveRecoveryKitPdf: (payload) => ipcRenderer.invoke(authIpc.saveRecoveryKitPdf.channel, payload),
  revokeRecoveryKit: (payload) => ipcRenderer.invoke(authIpc.revokeRecoveryKit.channel, payload),
  recoverWithKit: (payload) => ipcRenderer.invoke(authIpc.recoverWithKit.channel, payload),
}

const vaultDataApi: VaultIpcApi = {
  listVaults:      () => ipcRenderer.invoke(vaultIpc.listVaults.channel),
  createVault:     (payload) => ipcRenderer.invoke(vaultIpc.createVault.channel, payload),
  switchVault:     (payload) => ipcRenderer.invoke(vaultIpc.switchVault.channel, payload),
  renameVault:     (payload) => ipcRenderer.invoke(vaultIpc.renameVault.channel, payload),
  setVaultArchived: (payload) => ipcRenderer.invoke(vaultIpc.setVaultArchived.channel, payload),
  deleteVault:     (payload) => ipcRenderer.invoke(vaultIpc.deleteVault.channel, payload),
  mutate:          (payload) => ipcRenderer.invoke(vaultIpc.mutate.channel, payload),
  trackUsage:      (payload) => ipcRenderer.invoke(vaultIpc.trackUsage.channel, payload),
  copySecretField: (payload) => ipcRenderer.invoke(vaultIpc.copySecretField.channel, payload),
  copySecretImageField: (payload) => ipcRenderer.invoke(vaultIpc.copySecretImageField.channel, payload),
  saveSecretImageField: (payload) => ipcRenderer.invoke(vaultIpc.saveSecretImageField.channel, payload),
  previewCertificateMetadata: (payload) => ipcRenderer.invoke(vaultIpc.previewCertificateMetadata.channel, payload),
  revealSecretField: (payload) => ipcRenderer.invoke(vaultIpc.revealSecretField.channel, payload),
  revealSecretImageField: (payload) => ipcRenderer.invoke(vaultIpc.revealSecretImageField.channel, payload),
  revealSecretFields: (payload) => ipcRenderer.invoke(vaultIpc.revealSecretFields.channel, payload),
  setRevealPin:    (payload) => ipcRenderer.invoke(vaultIpc.setRevealPin.channel, payload),
  clearRevealPin:  (payload) => ipcRenderer.invoke(vaultIpc.clearRevealPin.channel, payload),
  lock:            () => ipcRenderer.invoke(vaultIpc.lock.channel),
  signOut:         () => ipcRenderer.invoke(vaultIpc.signOut.channel),
  backup:          () => ipcRenderer.invoke(vaultIpc.backup.channel),
  restoreBackup:   (payload) => ipcRenderer.invoke(vaultIpc.restoreBackup.channel, payload),
  restoreBackupWithKit: (payload) => ipcRenderer.invoke(vaultIpc.restoreBackupWithKit.channel, payload),
  exportJson:      (payload) => ipcRenderer.invoke(vaultIpc.exportJson.channel, payload),
  exportScope:     (payload) => ipcRenderer.invoke(vaultIpc.exportScope.channel, payload),
  saveImportTemplate: () => ipcRenderer.invoke(vaultIpc.saveImportTemplate.channel),
  beginEncryptedImport: (payload) => ipcRenderer.invoke(vaultIpc.beginEncryptedImport.channel, payload),
  commitEncryptedImport: (payload) => ipcRenderer.invoke(vaultIpc.commitEncryptedImport.channel, payload),
  cancelEncryptedImport: (payload) => ipcRenderer.invoke(vaultIpc.cancelEncryptedImport.channel, payload),
}

const auditApi: AuditIpcApi = {
  auditRead:       () => ipcRenderer.invoke(auditIpc.read.channel),
  auditExportJson: () => ipcRenderer.invoke(auditIpc.exportJson.channel),
}

const platformApi: Pick<PlatformIpcApi, 'openExternal' | 'copyImportTemplate' | 'setSecureInputEnabled'> = {
  openExternal:          (url) => ipcRenderer.invoke(platformIpc.openExternal.channel, url),
  copyImportTemplate:    () => ipcRenderer.invoke(platformIpc.copyImportTemplate.channel),
  setSecureInputEnabled: (enabled) => ipcRenderer.invoke(platformIpc.setSecureInputEnabled.channel, enabled),
}

const projectApi: ProjectIpcApi = {
  pickFolder:       (payload) => ipcRenderer.invoke(projectIpc.pickFolder.channel, payload),
  pickProjectFiles: () => ipcRenderer.invoke(projectIpc.pickProjectFiles.channel),
  scanProject:      (payload) => ipcRenderer.invoke(projectIpc.scan.channel, payload),
  discoverProjects: (payload) => ipcRenderer.invoke(projectIpc.discover.channel, payload),
  exportEnv:        (payload) => ipcRenderer.invoke(projectIpc.exportEnv.channel, payload),
}

const modeApi: ModeIpcApi = {
  setMode: (mode) => ipcRenderer.invoke(modeIpc.set.channel, { mode }),
  getMode: () => ipcRenderer.invoke(modeIpc.get.channel),
}

const menuPanelApi: MenuPanelIpcApi = {
  menuPanelStatus: () => ipcRenderer.invoke(menuPanelIpc.status.channel),
  menuPanelSearch: (payload) => ipcRenderer.invoke(menuPanelIpc.search.channel, payload),
  menuPanelCopy: (payload) => ipcRenderer.invoke(menuPanelIpc.copy.channel, payload),
  menuPanelReveal: (payload) => ipcRenderer.invoke(menuPanelIpc.reveal.channel, payload),
  menuPanelCreate: (payload) => ipcRenderer.invoke(menuPanelIpc.create.channel, payload),
  menuPanelAction: (payload) => ipcRenderer.invoke(menuPanelIpc.action.channel, payload),
  menuPanelOpenApp: () => ipcRenderer.invoke(menuPanelIpc.openApp.channel),
  menuPanelClose: () => ipcRenderer.invoke(menuPanelIpc.close.channel),
}

contextBridge.exposeInMainWorld('vault', {
  platform: process.platform,

  // Auth
  ...authApi,

  // Vault data
  ...vaultDataApi,
  ...auditApi,

  onAutoLock: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(vaultIpcEvents.autoLock, handler)
    return () => ipcRenderer.removeListener(vaultIpcEvents.autoLock, handler)
  },
  onVaultChanged: (cb: (change: unknown) => void) => {
    const handler = (_: unknown, change: unknown) => cb(change)
    ipcRenderer.on(vaultIpcEvents.changed, handler)
    return () => ipcRenderer.removeListener(vaultIpcEvents.changed, handler)
  },

  // Shell, security, and fixed clipboard actions
  ...platformApi,

  // Env projects
  ...projectApi,

  // App mode
  ...modeApi,
  ...menuPanelApi,
  onModeChange: (cb: (mode: string) => void) => {
    const handler = (_: unknown, mode: string) => cb(mode)
    ipcRenderer.on(modeIpcEvents.changed, handler)
    return () => ipcRenderer.removeListener(modeIpcEvents.changed, handler)
  },
})
