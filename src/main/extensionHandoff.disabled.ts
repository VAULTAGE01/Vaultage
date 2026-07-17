import type { BrowserWindow } from 'electron'

export interface ExtensionHandoff {
  source: 'browser-extension'
  mode: 'agent' | 'integrations'
  provider?: string
  host?: string
  page?: string
  receivedAt: string
}

export function registerExtensionProtocol(): void {}

export function parseExtensionHandoffUrl(_rawUrl: string, _agentToken?: string | null): ExtensionHandoff | null {
  return null
}

export function findExtensionHandoffArg(_argv: readonly string[], _agentToken?: string | null): ExtensionHandoff | null {
  return null
}

export function sendExtensionHandoff(_win: BrowserWindow | null, _handoff: ExtensionHandoff): void {}
