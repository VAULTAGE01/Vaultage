import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { ElectronApplication, Page } from 'playwright-core'
import {
  E2E_HEADLESS_INSPECTION_KEY,
} from './e2eHeadlessPolicy'
import {
  COMMUNITY_POLICY_PROTOCOLS,
  startCommunityPolicySentinel,
  type CommunityPolicySentinel,
} from './communityPolicyE2ESentinel'
import { selectCommunityUIE2EScenarios } from './communityUIE2ESelection'
import {
  cleanupAllCommunityUIE2EPolicyRuns,
  cleanupCommunityUIE2EPolicyRun,
  createCommunityUIE2EPolicyRun,
  launchCommunityUIE2EPolicyRun,
  type CommunityUIE2EPolicyRun,
} from './communityUIE2EPolicyRun'

async function probePage(page: Page, urls: readonly string[]): Promise<readonly boolean[]> {
  return await page.evaluate(async targetUrls => {
    const webSocketRejected = async (url: string): Promise<boolean> => await new Promise(resolve => {
      let socket: WebSocket | null = null
      const timer = setTimeout(() => { socket?.close(); resolve(false) }, 3_000)
      try {
        socket = new WebSocket(url)
        socket.addEventListener('open', () => { clearTimeout(timer); socket?.close(); resolve(false) }, { once: true })
        socket.addEventListener('error', () => { clearTimeout(timer); resolve(true) }, { once: true })
      } catch {
        clearTimeout(timer)
        resolve(true)
      }
    })
    return await Promise.all([
      fetch(targetUrls[0] ?? '').then(() => false, () => true),
      fetch(targetUrls[1] ?? '').then(() => false, () => true),
      webSocketRejected(targetUrls[2] ?? ''),
      webSocketRejected(targetUrls[3] ?? ''),
    ])
  }, urls)
}

function objectAt(value: unknown, key: PropertyKey): object {
  if (typeof value !== 'object' || value === null) throw new TypeError('Policy inspection is unavailable')
  const nested: unknown = Reflect.get(value, key)
  if (typeof nested !== 'object' || nested === null) throw new TypeError('Policy inspection field is unavailable')
  return nested
}

function numberAt(value: object, key: PropertyKey): number {
  const nested: unknown = Reflect.get(value, key)
  if (typeof nested !== 'number') throw new TypeError('Policy inspection counter is unavailable')
  return nested
}

describe.sequential('Community headless runtime policy E2E', () => {
  it('keeps lifecycle, clipboard, and all loopback protocol probes isolated', async () => {
    // Given
    const selected = selectCommunityUIE2EScenarios(
      process.env['VAULTAGE_COMMUNITY_E2E_SCENARIOS'],
    ).policy
    if (selected.length === 0) return
    let run: CommunityUIE2EPolicyRun | null = null
    const sentinels: CommunityPolicySentinel[] = []
    let application: ElectronApplication | null = null
    try {
      const activeRun = createCommunityUIE2EPolicyRun()
      run = activeRun
      for (const protocol of COMMUNITY_POLICY_PROTOCOLS) {
        sentinels.push(await startCommunityPolicySentinel(protocol))
      }
      const urls = sentinels.map(sentinel => sentinel.url)
      application = await launchCommunityUIE2EPolicyRun(activeRun)
      const mainPage = await application.firstWindow({ timeout: 20_000 })
      const probeWindow = application.waitForEvent('window', { predicate: page => page.url().startsWith('data:text/html') })
      const probeId = await application.evaluate(async ({ BrowserWindow }) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: { partition: 'vaultage-e2e-policy-probe', sandbox: true, contextIsolation: true, nodeIntegration: false },
        })
        await window.loadURL('data:text/html,<title>policy-probe</title>')
        return window.id
      })
      const rendererPage = await probeWindow

      // When
      const mainProcessResults = await application.evaluate(async (_electron, targetUrls) => {
        const fetchRejected = async (url: string): Promise<boolean> => {
          return await fetch(url).then(() => false, () => true)
        }
        const webSocketRejected = (url: string): boolean => {
          try {
            const socket = new WebSocket(url)
            socket.close()
            return false
          } catch {
            return true
          }
        }
        return await Promise.all([
          fetchRejected(targetUrls[0] ?? ''),
          fetchRejected(targetUrls[1] ?? ''),
          webSocketRejected(targetUrls[2] ?? ''),
          webSocketRejected(targetUrls[3] ?? ''),
        ])
      }, urls)
      const mainRendererResults = await probePage(mainPage, urls)
      const partitionRendererResults = await probePage(rendererPage, urls)
      const state = await application.evaluate(({ app, BrowserWindow, clipboard }, input) => {
        clipboard.writeText(input.clipboardValue)
        const copied = clipboard.readText()
        clipboard.clear()
        const cleared = clipboard.readText()
        Reflect.apply(app.emit, app, ['activate'])
        Reflect.apply(app.emit, app, ['second-instance', {}, [], '', {}])
        Reflect.apply(app.emit, app, ['open-url', { preventDefault: () => undefined }, input.openUrl])
        BrowserWindow.fromId(input.probeId)?.destroy()
        const inspect: unknown = Reflect.get(globalThis, input.inspectionKey)
        if (typeof inspect !== 'function') throw new TypeError('Headless inspection surface is unavailable')
        return {
          copied,
          cleared,
          appPath: app.getAppPath(),
          dockVisible: process.platform === 'darwin' ? app.dock?.isVisible() : false,
          inspection: Reflect.apply(inspect, globalThis, []),
          packaged: app.isPackaged,
          userData: app.getPath('userData'),
          windowsHidden: BrowserWindow.getAllWindows().every(window => !window.isVisible()),
        }
      }, {
        clipboardValue: 'synthetic-policy-clipboard-value',
        inspectionKey: E2E_HEADLESS_INSPECTION_KEY,
        openUrl: urls[0] ?? 'http://127.0.0.1:1/probe',
        probeId,
      })

      // Then
      expect(mainProcessResults).toEqual([true, true, true, true])
      expect(mainRendererResults).toEqual([true, true, true, true])
      expect(partitionRendererResults).toEqual([true, true, true, true])
      expect(sentinels.map(sentinel => sentinel.accepted())).toEqual([0, 0, 0, 0])
      expect(state.packaged).toBe(false)
      expect(realpathSync(state.appPath)).toBe(realpathSync(activeRun.appRoot))
      expect(realpathSync(fileURLToPath(mainPage.url()))).toBe(
        realpathSync(join(activeRun.appRoot, 'out', 'renderer', 'index.html')),
      )
      expect(realpathSync(state.userData)).toBe(realpathSync(activeRun.profileDir))
      expect(state.windowsHidden).toBe(true)
      expect(state.dockVisible).toBe(false)
      expect(state.copied).toBe('synthetic-policy-clipboard-value')
      expect(state.cleared).toBe('')
      const network = objectAt(state.inspection, 'network')
      const clipboard = objectAt(state.inspection, 'clipboard')
      const visibility = objectAt(state.inspection, 'visibility')
      const attempts = objectAt(visibility, 'attempts')
      const created = objectAt(visibility, 'created')
      for (const key of ['http', 'https', 'ws', 'wss', 'rendererHttp', 'rendererHttps', 'rendererWs', 'rendererWss']) {
        expect(numberAt(network, key)).toBeGreaterThanOrEqual(1)
      }
      expect(numberAt(clipboard, 'writes')).toBe(1)
      expect(numberAt(clipboard, 'reads')).toBe(2)
      expect(numberAt(clipboard, 'clears')).toBe(1)
      expect(numberAt(visibility, 'showEvents')).toBe(0)
      expect(numberAt(attempts, 'activate')).toBe(1)
      expect(numberAt(attempts, 'secondInstance')).toBe(1)
      expect(numberAt(attempts, 'openUrl')).toBe(1)
      expect(numberAt(created, 'menuPanels')).toBe(0)
      expect(numberAt(created, 'trays')).toBe(0)
    } finally {
      if (run) await cleanupCommunityUIE2EPolicyRun(application, run, sentinels)
    }
  }, 60_000)
})

afterAll(async () => {
  await cleanupAllCommunityUIE2EPolicyRuns()
})
