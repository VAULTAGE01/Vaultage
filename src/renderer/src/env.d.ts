/// <reference types="vite/client" />

declare const __VAULTAGE_OPEN_CORE__: boolean
declare const __VAULTAGE_UI2026_FLAGS__: unknown
declare const __VAULTAGE_UI2026_SHOWCASE__: boolean

type AuditIpcApi = import('../../shared/auditIpcContracts').AuditIpcApi
type AuthIpcApi = import('../../shared/authIpcContracts').AuthIpcApi
type ModeIpcApi = import('../../shared/modeIpcContracts').ModeIpcApi
type MenuPanelIpcApi = import('../../shared/menuPanelIpcContracts').MenuPanelIpcApi
type PlatformIpcApi = Pick<
  import('../../shared/platformIpcContracts').PlatformIpcApi,
  'openExternal' | 'copyImportTemplate' | 'setSecureInputEnabled'
>
type ProjectIpcApi = import('../../shared/projectIpcContracts').ProjectIpcApi
type VaultIpcApi = import('../../shared/vaultIpcContracts').VaultIpcApi
type VaultChangedEvent = import('../../shared/vaultIpcContracts').VaultChangedEvent

type AuditVerification = import('../../shared/auditIpcContracts').AuditVerification
type AuditEvent = import('../../shared/auditIpcContracts').AuditEvent

type WindowVaultApi =
  & AuditIpcApi
  & AuthIpcApi
  & ModeIpcApi
  & MenuPanelIpcApi
  & PlatformIpcApi
  & ProjectIpcApi
  & VaultIpcApi

interface Window {
  vault: WindowVaultApi & {
    platform: string
    onAutoLock: (cb: () => void) => () => void
    onVaultChanged: (cb: (change: VaultChangedEvent) => void) => () => void
    onModeChange: (cb: (mode: string) => void) => () => void
  }
}
