import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectScanRequest } from '../shared/projectScan'

contextBridge.exposeInMainWorld('vault', {
  platform: process.platform,

  // Auth
  status:         (): Promise<{ needsSetup: boolean }> => ipcRenderer.invoke('auth:status'),
  setup:          (pw: string) => ipcRenderer.invoke('auth:setup', pw),
  touchID:        ()           => ipcRenderer.invoke('auth:touchid'),
  confirmTouchID: (prompt?: string) => ipcRenderer.invoke('auth:confirm', { prompt }),
  password:       (pw: string) => ipcRenderer.invoke('auth:password', pw),
  changePassword: (passwords: { current: string; next: string }) =>
    ipcRenderer.invoke('auth:change-password', passwords),

  // Vault data
  save:            (data: string) => ipcRenderer.invoke('vault:save', data),
  trackUsage:      (p: { secretId: string }) => ipcRenderer.invoke('vault:track-usage', p),
  copySecretField: (p: { secretId: string; fieldKey: string; clearAfterMs?: number }) =>
    ipcRenderer.invoke('vault:copy-secret-field', p),
  copySecretImageField: (p: { secretId: string; fieldKey: string }) =>
    ipcRenderer.invoke('vault:copy-secret-image-field', p),
  revealSecretField: (p: { secretId: string; fieldKey: string; confirmationPhrase?: string; pin?: string }) =>
    ipcRenderer.invoke('vault:reveal-secret-field', p),
  revealSecretImageField: (p: { secretId: string; fieldKey: string; confirmationPhrase?: string; pin?: string }) =>
    ipcRenderer.invoke('vault:reveal-secret-image-field', p),
  revealSecretFields: (p: { secretId: string; confirmationPhrase?: string; pin?: string }) =>
    ipcRenderer.invoke('vault:reveal-secret-fields', p),
  setRevealPin: (p: { pin: string; masterPassword: string }) =>
    ipcRenderer.invoke('vault:set-reveal-pin', p),
  clearRevealPin: (p: { masterPassword: string }) =>
    ipcRenderer.invoke('vault:clear-reveal-pin', p),
  lock:            ()             => ipcRenderer.invoke('vault:lock'),
  signOut:         ()             => ipcRenderer.invoke('vault:sign-out'),
  backup:          ()             => ipcRenderer.invoke('vault:backup'),
  exportJson:      (p?: { plaintextConfirmation?: string }) => ipcRenderer.invoke('vault:export-json', p),
  exportScope:     (p: {
    scope: { kind: 'vault' } | { kind: 'folder'; id: string } | { kind: 'secret'; id: string }
    format: 'json' | 'csv' | 'encrypted'
    plaintextConfirmation?: string
    encryptionPassword?: string
  }) => ipcRenderer.invoke('vault:export-scope', p),
  decryptExport:   (p: { data: string; password: string }) => ipcRenderer.invoke('vault:decrypt-export', p),
  auditRead:  ()             => ipcRenderer.invoke('audit:read'),
  auditExportJson: ()        => ipcRenderer.invoke('audit:export-json'),

  onAutoLock: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('vault:auto-lock', handler)
    return () => ipcRenderer.removeListener('vault:auto-lock', handler)
  },

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Clipboard-backed fixed actions
  copyImportTemplate: () => ipcRenderer.invoke('import:copy-template'),

  // Security
  setSecureInputEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('security:set-secure-input', enabled),

  // Env projects
  pickFolder: ()                                                    => ipcRenderer.invoke('project:pick-folder'),
  pickProjectFiles: ()                                              => ipcRenderer.invoke('project:pick-files'),
  scanProject: (p: ProjectScanRequest)                              => ipcRenderer.invoke('project:scan', p),
  exportEnv:  (p: {
    path: string
    selections: { envKey: string; secretId: string; fieldKey: string }[]
    addToGitignore: boolean
    plaintextConfirmation?: string
  }) =>
    ipcRenderer.invoke('project:export-env', p),

  // App mode
  setMode:    (mode: string) => ipcRenderer.invoke('mode:set', { mode }),
  getMode:    ()             => ipcRenderer.invoke('mode:get'),
  onModeChange: (cb: (mode: string) => void) => {
    const handler = (_: unknown, mode: string) => cb(mode)
    ipcRenderer.on('mode:changed', handler)
    return () => ipcRenderer.removeListener('mode:changed', handler)
  },
})
