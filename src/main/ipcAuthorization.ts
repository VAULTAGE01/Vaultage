import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'

export type ExpectedWebContents = () => WebContents | null

/**
 * Restricts every invoke handler registered through this facade to one live,
 * top-level renderer. This keeps a compromised secondary window or subframe
 * from reaching privileged channels even if it learns their names.
 */
export function createAuthorizedIpcMain(
  ipcMain: IpcMain,
  expectedWebContents: ExpectedWebContents,
  surface: string,
): IpcMain {
  return new Proxy(ipcMain, {
    get(target, property) {
      if (property === 'handle') {
        return (
          channel: string,
          listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
        ): void => {
          target.handle(channel, async (event, ...args) => {
            if (!isAuthorizedIpcSender(event, expectedWebContents())) {
              console.warn(`[ipc] Rejected unauthorized ${surface} invocation`, {
                channel,
                senderId: event.sender.id,
              })
              throw new Error('IPC sender is not authorized')
            }
            return listener(event, ...args)
          })
        }
      }

      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function isAuthorizedIpcSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  expected: WebContents | null,
): boolean {
  if (!expected || expected.isDestroyed()) return false
  if (event.sender.id !== expected.id) return false
  const mainFrame = expected.mainFrame
  return Boolean(mainFrame && event.senderFrame === mainFrame)
}
