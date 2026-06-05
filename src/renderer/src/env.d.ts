/// <reference types="vite/client" />

declare const __VAULTAGE_OPEN_CORE__: boolean

type ProjectScanRequest = import('../../shared/projectScan').ProjectScanRequest
type ProjectScanResult = import('../../shared/projectScan').ProjectScanResult
type VaultExportScope = import('../../shared/vaultExport').VaultExportScope
type VaultExportFormat = import('../../shared/vaultExport').VaultExportFormat

type AuditVerification =
  | { ok: true }
  | { ok: false; index: number; reason: string }

interface AuditEvent {
  id: string
  timestamp: string
  type: string
  details: Record<string, unknown>
  previousHash: string | null
  hashScheme?: 'sha256' | 'hmac-sha256'
  hash: string
}

interface Window {
  vault: {
    platform: string

    status: () => Promise<{ needsSetup: boolean }>
    setup: (pw: string) => Promise<{ success: boolean; data?: unknown; error?: string; touchIdRestored?: boolean }>
    touchID: () => Promise<{ success: boolean; data?: unknown; error?: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean; touchIdInvalid?: boolean }>
    confirmTouchID: (prompt?: string) => Promise<{ success: boolean; error?: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean }>
    password: (pw: string) => Promise<{ success: boolean; data?: unknown; error?: string; wrongPassword?: boolean; touchIdRestored?: boolean }>
    changePassword: (passwords: { current: string; next: string }) => Promise<{ success: boolean; wrongPassword?: boolean; error?: string; touchIdRestored?: boolean }>

    save: (data: string) => Promise<{ success: boolean; revision?: number; data?: unknown; stale?: boolean; error?: string }>
    trackUsage: (p: { secretId: string }) => Promise<{ success: boolean; revision?: number; error?: string }>
    copySecretField: (p: { secretId: string; fieldKey: string; clearAfterMs?: number }) => Promise<{ success: boolean; revision?: number; error?: string }>
    copySecretImageField: (p: { secretId: string; fieldKey: string }) => Promise<{ success: boolean; revision?: number; error?: string }>
    revealSecretField: (p: { secretId: string; fieldKey: string; confirmationPhrase?: string; pin?: string }) => Promise<{ success: boolean; value?: string; revision?: number; error?: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean }>
    revealSecretImageField: (p: { secretId: string; fieldKey: string; confirmationPhrase?: string; pin?: string }) => Promise<{ success: boolean; value?: string; revision?: number; error?: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean }>
    revealSecretFields: (p: { secretId: string; confirmationPhrase?: string; pin?: string }) => Promise<{ success: boolean; fields?: { key: string; value: string; sensitive: boolean }[]; revision?: number; error?: string; cancelled?: boolean; notFound?: boolean; authFailed?: boolean }>
    setRevealPin: (p: { pin: string; masterPassword: string }) => Promise<{ success: boolean; revision?: number; data?: unknown; wrongPassword?: boolean; error?: string }>
    clearRevealPin: (p: { masterPassword: string }) => Promise<{ success: boolean; revision?: number; data?: unknown; wrongPassword?: boolean; error?: string }>
    lock: () => Promise<{ success: boolean }>
    signOut: () => Promise<{ success: boolean; error?: string }>
    backup: () => Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }>
    exportJson: (p?: { plaintextConfirmation?: string }) => Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }>
    exportScope: (p: { scope: VaultExportScope; format: VaultExportFormat; plaintextConfirmation?: string; encryptionPassword?: string }) => Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }>
    decryptExport: (p: { data: string; password: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>
    auditRead: () => Promise<{ success: boolean; events?: AuditEvent[]; verification?: AuditVerification; error?: string }>
    auditExportJson: () => Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }>

    onAutoLock: (cb: () => void) => () => void
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    copyImportTemplate: () => Promise<{ success: boolean; error?: string }>
    setSecureInputEnabled: (enabled: boolean) => Promise<{ success: boolean; available: boolean; error?: string }>

    pickFolder: () => Promise<string | null>
    pickProjectFiles: () => Promise<string[]>
    scanProject: (p: ProjectScanRequest) => Promise<{ success: boolean; result?: ProjectScanResult; error?: string }>
    exportEnv: (p: {
      path: string
      selections: { envKey: string; secretId: string; fieldKey: string }[]
      addToGitignore: boolean
      plaintextConfirmation?: string
    }) => Promise<{ success: boolean; error?: string }>

    setMode: (mode: string) => Promise<{ success: boolean; error?: string }>
    getMode: () => Promise<string>
    onModeChange: (cb: (mode: string) => void) => () => void
  }
}
