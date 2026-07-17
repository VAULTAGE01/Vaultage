import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { registerModeIpc, type ModeAgentController } from './modeIpc'

describe('Services mode commercial boundary', () => {
  it('rejects direct broker mode IPC before changing mode', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const setMode = vi.fn()
    registerModeIpc({
      handle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, handler) },
    } as unknown as IpcMain, {
      getMode: () => 'local', setMode, getWindow: () => null,
      agentServer: { syncListenerState: vi.fn() } as unknown as ModeAgentController,
      recordAudit: vi.fn(),
      authorizeServices: async () => { throw new Error('Vaultage Pro Services access is required') },
    })

    await expect(handlers.get('mode:set')?.({}, { mode: 'broker' })).resolves.toMatchObject({ success: false })
    expect(setMode).not.toHaveBeenCalled()
  })
})
