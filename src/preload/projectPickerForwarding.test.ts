import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectPickFolderPayload } from '../shared/projectIpcContracts'
import { projectIpcContracts } from '../shared/projectIpcContracts'

type ExposedApi = Record<string, unknown>
type ExposeInMainWorld = (name: string, api: ExposedApi) => void
type Invoke = (channel: string, ...payload: readonly unknown[]) => Promise<unknown>

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<ExposeInMainWorld>(),
  invoke: vi.fn<Invoke>(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}))

describe('Project picker preload forwarding', () => {
  beforeEach(() => {
    vi.resetModules()
    electronMocks.exposeInMainWorld.mockClear()
    electronMocks.invoke.mockClear()
    electronMocks.on.mockClear()
    electronMocks.removeListener.mockClear()
  })

  it.each([
    ['private', './index'],
    ['open', './index.open'],
  ] as const)('forwards exact payload objects through the %s bridge', async (_edition, modulePath) => {
    const exposedApi = await loadPreloadApi(modulePath)
    const pickFolder = exposedApi.pickFolder
    if (typeof pickFolder !== 'function') throw new Error('Project picker API is not exposed')

    const payloads: readonly ProjectPickFolderPayload[] = [
      { purpose: 'project-local-path' },
      { purpose: 'project-local-path', projectId: 'different-from-create-fallback' },
      { purpose: 'scan-parent' },
    ]

    for (const payload of payloads) {
      electronMocks.invoke.mockClear()
      await pickFolder(payload)

      expect(electronMocks.invoke).toHaveBeenCalledTimes(1)
      const invocation = electronMocks.invoke.mock.calls[0]
      expect(invocation?.[0]).toBe(projectIpcContracts.pickFolder.channel)
      expect(invocation?.[1]).toBe(payload)
    }
  })
})

async function loadPreloadApi(modulePath: './index' | './index.open'): Promise<ExposedApi> {
  await import(modulePath)
  const exposures = electronMocks.exposeInMainWorld.mock.calls
  const exposure = exposures[exposures.length - 1]
  if (!exposure) throw new Error('Preload bridge did not expose a window API')
  if (exposure[0] !== 'vault') throw new Error('Preload bridge exposed an unexpected API name')
  return exposure[1]
}
