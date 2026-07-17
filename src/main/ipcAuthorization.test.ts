import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { createAuthorizedIpcMain, isAuthorizedIpcSender } from './ipcAuthorization'

function webContents(id: number, destroyed = false): WebContents {
  const mainFrame = { routingId: id }
  return {
    id,
    mainFrame,
    isDestroyed: () => destroyed,
  } as unknown as WebContents
}

describe('IPC sender authorization', () => {
  it('accepts only the expected live top-level renderer', () => {
    const expected = webContents(7)
    expect(isAuthorizedIpcSender({
      sender: expected,
      senderFrame: expected.mainFrame,
    } as IpcMainInvokeEvent, expected)).toBe(true)

    expect(isAuthorizedIpcSender({
      sender: webContents(8),
      senderFrame: expected.mainFrame,
    } as IpcMainInvokeEvent, expected)).toBe(false)

    expect(isAuthorizedIpcSender({
      sender: expected,
      senderFrame: { routingId: 99 },
    } as unknown as IpcMainInvokeEvent, expected)).toBe(false)

    expect(isAuthorizedIpcSender({
      sender: expected,
      senderFrame: expected.mainFrame,
    } as IpcMainInvokeEvent, webContents(7, true))).toBe(false)
  })

  it('wraps registered invoke handlers and rejects another window', async () => {
    let registered: ((event: IpcMainInvokeEvent, payload: unknown) => unknown) | undefined
    const delegate = {
      handle: vi.fn((_channel, listener) => { registered = listener }),
    } as unknown as IpcMain
    const expected = webContents(7)
    const listener = vi.fn(() => 'ok')

    createAuthorizedIpcMain(delegate, () => expected, 'main').handle('vault:test', listener)

    await expect(registered!({
      sender: webContents(8),
      senderFrame: expected.mainFrame,
    } as IpcMainInvokeEvent, null)).rejects.toThrow('not authorized')
    expect(listener).not.toHaveBeenCalled()

    await expect(registered!({
      sender: expected,
      senderFrame: expected.mainFrame,
    } as IpcMainInvokeEvent, null)).resolves.toBe('ok')
    expect(listener).toHaveBeenCalledOnce()
  })
})
