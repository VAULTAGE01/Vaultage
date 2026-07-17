import type { BrowserWindow, IpcMain } from 'electron'
import type { AuditEventType } from './audit'
import { type AppMode, isAppMode } from './security'
import { modeIpcContracts, modeIpcEvents } from '../shared/modeIpcContracts'

export interface ModeAgentController {
  setApiEnabledState(enabled: boolean): void
  cancelPendingAgentRequests(reason: string): void
  syncListenerState(): Promise<void>
}

export interface ModeIpcDeps {
  getMode: () => AppMode
  setMode: (mode: AppMode) => void
  getWindow: () => BrowserWindow | null
  agentServer: ModeAgentController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
  authorizeServices?: () => Promise<void>
}

export function registerModeIpc(ipcMain: IpcMain, deps: ModeIpcDeps): void {
  const modeIpc = modeIpcContracts

  ipcMain.handle(modeIpc.get.channel, (_, payload: unknown) => {
    modeIpc.get.validate(payload)
    return deps.getMode()
  })

  ipcMain.handle(modeIpc.set.channel, async (_, rawPayload: unknown) => {
    const { mode } = modeIpc.set.validate(rawPayload)
    if (!isAppMode(mode)) return { success: false, error: 'Invalid app mode' }
    if (mode === 'broker') {
      try {
        if (!deps.authorizeServices) throw new Error('Commercial capability policy is unavailable')
        await deps.authorizeServices()
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    if (mode === deps.getMode()) return { success: true }

    const prev = deps.getMode()
    if (prev === 'agent' && mode !== 'agent') {
      deps.agentServer.setApiEnabledState(false)
      deps.agentServer.cancelPendingAgentRequests('Mode switched out of Agent')
    }

    deps.setMode(mode)

    try {
      await deps.agentServer.syncListenerState()
    } catch (err) {
      deps.setMode(prev)
      return { success: false, error: `Failed to switch local project mode: ${String(err)}` }
    }

    deps.getWindow()?.webContents.send(modeIpcEvents.changed, mode)
    deps.recordAudit('mode.change', { from: prev, to: mode })
    return { success: true }
  })
}
