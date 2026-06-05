import type { BrowserWindow, IpcMain } from 'electron'
import type { AgentServerController } from '#agent-server'
import type { AuditEventType } from './audit'
import { type AppMode, isAppMode } from './security'

export interface ModeIpcDeps {
  getMode: () => AppMode
  setMode: (mode: AppMode) => void
  getWindow: () => BrowserWindow | null
  agentServer: AgentServerController
  recordAudit: (type: AuditEventType, details?: Record<string, unknown>) => void
}

export function registerModeIpc(ipcMain: IpcMain, deps: ModeIpcDeps): void {
  ipcMain.handle('mode:get', () => deps.getMode())

  ipcMain.handle('mode:set', async (_, { mode }: { mode: unknown }) => {
    if (!isAppMode(mode)) return { success: false, error: 'Invalid app mode' }
    if (mode === deps.getMode()) return { success: true }

    const prev = deps.getMode()
    if (prev === 'agent' && mode !== 'agent') {
      deps.agentServer.setApiEnabledState(false)
      deps.agentServer.cancelPendingRequests('Mode switched out of Agent')
    }

    deps.setMode(mode)

    try {
      if (mode === 'agent' && prev !== 'agent') {
        await deps.agentServer.start()
      } else if (prev === 'agent' && mode !== 'agent') {
        await deps.agentServer.stop()
      }
    } catch (err) {
      deps.setMode(prev)
      return { success: false, error: `Failed to switch local project mode: ${String(err)}` }
    }

    deps.getWindow()?.webContents.send('mode:changed', mode)
    deps.recordAudit('mode.change', { from: prev, to: mode })
    return { success: true }
  })
}
