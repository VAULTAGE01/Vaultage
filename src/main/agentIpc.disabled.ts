import type { IpcMain } from 'electron'
import type { AgentServerController } from '#agent-server'

export interface AgentIpcDeps {
  hasVaultKey: () => boolean
  getAgentApiToken: () => Promise<string>
}

export function registerAgentIpc(ipcMain: IpcMain, agentServer: AgentServerController, deps: AgentIpcDeps): void {
  void ipcMain
  void agentServer
  void deps
}
