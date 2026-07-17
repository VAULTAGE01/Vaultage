import type { IpcMain } from 'electron'
import { registerVaultDataIpc } from './vaultDataIpc'
import { registerVaultExportIpc } from './vaultExportIpc'
import { registerVaultSecretIpc } from './vaultSecretIpc'
import { registerVaultSessionIpc } from './vaultSessionIpc'
import type { VaultIpcDeps } from './vaultIpcCommon'

export type { VaultIpcDeps } from './vaultIpcCommon'

export function registerVaultIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  registerVaultDataIpc(ipcMain, deps)
  registerVaultSecretIpc(ipcMain, deps)
  registerVaultSessionIpc(ipcMain, deps)
  registerVaultExportIpc(ipcMain, deps)
}
