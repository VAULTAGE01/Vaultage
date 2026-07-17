import type { IpcMain } from 'electron'

export type ExtensionNativeHostAction = 'install' | 'repair' | 'remove'
export interface ExtensionNativeHostIpcDeps {}
export interface ExtensionNativeHostRegistrar { assertExecutableReady(): Promise<void> }

export function registerExtensionNativeHostIpc(_ipcMain: IpcMain, _deps: ExtensionNativeHostIpcDeps): void {}
export async function requireInstalledExtensionNativeHost(_registrar: ExtensionNativeHostRegistrar | null): Promise<void> {}
export async function extensionNativeHostLaunchIssue(_registrar: ExtensionNativeHostRegistrar | null): Promise<string | null> { return null }
