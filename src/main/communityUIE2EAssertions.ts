import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'path'
import { expect } from 'vitest'
import type { ElectronApplication, Page } from 'playwright-core'
import { E2E_HEADLESS_INSPECTION_KEY } from './e2eHeadlessPolicy'
import type { CommunityUIE2EResources, CommunityUIE2ERun } from './communityUIE2ERun'

export type CommunityUIE2ECheckpoint = {
  readonly acceptedSockets: number
  readonly checkpoint: string
  readonly networkAttempts: number
  readonly windows: number
}

export type CommunityUIE2EPersistence = {
  readonly directoryModes: { readonly '0700': number }
  readonly encryptedFiles: number
  readonly fileModes: { readonly '0600': number }
  readonly profileFilesScanned: number
}

export type CommunityUIE2EPlaintextPolicy = {
  readonly alwaysForbidden: readonly string[]
  readonly auditFieldIdentifiers: readonly string[]
}

function objectAt(value: unknown, key: PropertyKey): object {
  if (typeof value !== 'object' || value === null) throw new TypeError('E2E inspection is unavailable')
  const nested: unknown = Reflect.get(value, key)
  if (typeof nested !== 'object' || nested === null) throw new TypeError('E2E inspection field is unavailable')
  return nested
}

function numberAt(value: object, key: PropertyKey): number {
  const nested: unknown = Reflect.get(value, key)
  if (typeof nested !== 'number') throw new TypeError('E2E inspection counter is unavailable')
  return nested
}

export async function assertCommunityUIE2ECheckpoint(
  application: ElectronApplication,
  page: Page,
  resources: CommunityUIE2EResources,
  checkpoint: string,
): Promise<CommunityUIE2ECheckpoint> {
  const state = await application.evaluate(({ app, BrowserWindow }, inspectionKey) => {
    type RuntimeWebPreferences = {
      readonly contextIsolation?: boolean
      readonly nodeIntegration?: boolean
      readonly sandbox?: boolean
    }
    const inspectPreferences = (value: unknown): RuntimeWebPreferences => {
      if (typeof value !== 'object' || value === null) {
        throw new TypeError('Electron webContents is unavailable')
      }
      const inspect: unknown = Reflect.get(value, 'getLastWebPreferences')
      if (typeof inspect !== 'function') throw new TypeError('Runtime preferences inspector is unavailable')
      return Reflect.apply(inspect, value, [])
    }
    const inspect: unknown = Reflect.get(globalThis, inspectionKey)
    if (typeof inspect !== 'function') throw new TypeError('Headless inspection surface is unavailable')
    return {
      appName: app.getName(),
      appPath: app.getAppPath(),
      argv: process.argv,
      dockVisible: process.platform === 'darwin' ? app.dock?.isVisible() : false,
      inspection: Reflect.apply(inspect, globalThis, []),
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      windows: BrowserWindow.getAllWindows().map(window => ({
        preferences: inspectPreferences(window.webContents),
        visible: window.isVisible(),
      })),
    }
  }, E2E_HEADLESS_INSPECTION_KEY)
  const run = resources.run
  expect(state.packaged).toBe(false)
  expect(state.appName).toBe('vault-OC')
  expect(realpathSync(state.appPath)).toBe(realpathSync(run.appRoot))
  expect(realpathSync(state.userData)).toBe(realpathSync(run.profileDir))
  expect(state.argv.filter(argument => argument === `--user-data-dir=${run.profileDir}`)).toHaveLength(1)
  expect(new URL(page.url()).protocol).toBe('file:')
  expect(realpathSync(fileURLToPath(page.url()))).toBe(
    realpathSync(join(run.appRoot, 'out', 'renderer', 'index.html')),
  )
  expect(existsSync(join(run.appRoot, 'resources', 'vault-keychain'))).toBe(false)
  expect(state.windows.length).toBeGreaterThan(0)
  expect(state.windows.every(window => !window.visible)).toBe(true)
  expect(state.dockVisible).toBe(false)
  for (const window of state.windows) {
    expect(window.preferences.sandbox).toBe(true)
    expect(window.preferences.contextIsolation).toBe(true)
    expect(window.preferences.nodeIntegration).toBe(false)
  }
  expect(await page.evaluate(() => typeof Reflect.get(window, 'require'))).toBe('undefined')

  const visibility = objectAt(state.inspection, 'visibility')
  const attempts = objectAt(visibility, 'attempts')
  const created = objectAt(visibility, 'created')
  expect(numberAt(visibility, 'showEvents')).toBe(0)
  for (const key of ['focus', 'menuPanel', 'restore', 'show', 'showInactive']) {
    expect(numberAt(attempts, key)).toBe(0)
  }
  expect(numberAt(created, 'menuPanels')).toBe(0)
  expect(numberAt(created, 'trays')).toBe(0)

  const clipboard = objectAt(state.inspection, 'clipboard')
  expect(numberAt(clipboard, 'textLength')).toBe(0)

  const network = objectAt(state.inspection, 'network')
  const networkKeys = [
    'fetch', 'http', 'https', 'net', 'rendererHttp', 'rendererHttps',
    'rendererWs', 'rendererWss', 'tls', 'udp', 'ws', 'wss',
  ] as const
  const networkAttempts = networkKeys.reduce((total, key) => total + numberAt(network, key), 0)
  const acceptedSockets = resources.sentinels.reduce((total, sentinel) => total + sentinel.accepted(), 0)
  expect(acceptedSockets).toBe(0)
  return { acceptedSockets, checkpoint, networkAttempts, windows: state.windows.length }
}

export function assertEncryptedCommunityProfile(
  run: CommunityUIE2ERun,
  policy: CommunityUIE2EPlaintextPolicy,
): CommunityUIE2EPersistence {
  const vaultDir = join(run.profileDir, 'vault-data')
  expect(existsSync(vaultDir)).toBe(true)
  const vaultFiles: string[] = []
  const vaultDirectories: string[] = []
  const visitVault = (directory: string): void => {
    vaultDirectories.push(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visitVault(path)
      else if (entry.isFile()) vaultFiles.push(path)
      else throw new TypeError('Vault persistence contains an unsupported entry')
    }
  }
  visitVault(vaultDir)
  for (const directory of vaultDirectories) expect(statSync(directory).mode & 0o777).toBe(0o700)
  let encryptedFiles = 0
  for (const path of vaultFiles) {
    expect(statSync(path).mode & 0o777).toBe(0o600)
    if (/vault\.[0-9a-f-]+\.enc$/u.test(path)) encryptedFiles += 1
  }
  const profileFiles: string[] = []
  const visitProfile = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visitProfile(path)
      else if (entry.isFile()) profileFiles.push(path)
    }
  }
  visitProfile(run.profileDir)
  for (const path of profileFiles) {
    const bytes = readFileSync(path)
    for (const value of policy.alwaysForbidden) {
      expect(bytes.includes(Buffer.from(value, 'utf8'))).toBe(false)
    }
    const auditMetadata = dirname(path) === vaultDir
      && /^audit\.log(?:\.segment-[0-9a-f]+\.jsonl)?$/u.test(basename(path))
    if (!auditMetadata) {
      for (const value of policy.auditFieldIdentifiers) {
        expect(bytes.includes(Buffer.from(value, 'utf8'))).toBe(false)
      }
    }
  }
  expect(vaultFiles.length).toBeGreaterThan(2)
  expect(encryptedFiles).toBeGreaterThan(0)
  return {
    directoryModes: { '0700': vaultDirectories.length },
    encryptedFiles,
    fileModes: { '0600': vaultFiles.length },
    profileFilesScanned: profileFiles.length,
  }
}

export async function readAndClearE2EClipboard(application: ElectronApplication): Promise<string> {
  return await application.evaluate(({ clipboard }) => {
    const value = clipboard.readText()
    clipboard.clear()
    return value
  })
}
