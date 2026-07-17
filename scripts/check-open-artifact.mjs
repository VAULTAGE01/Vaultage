import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  findPrivateIpcNamespaceLeaks,
  findPrivatePreloadIpcChannelLeaks,
} from './open-source-config.mjs'

const root = process.cwd()
const mainDir = join(root, 'out', 'main')
const preloadDir = join(root, 'out', 'preload')
const rendererAssetsDir = join(root, 'out', 'renderer', 'assets')

const failures = []

function fail(message) {
  failures.push(message)
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

const mainIndex = readIfExists(join(mainDir, 'index.js'))
if (!mainIndex) {
  fail('open artifact is missing out/main/index.js')
}

const preloadIndex = readIfExists(join(preloadDir, 'index.js'))
if (!preloadIndex) {
  fail('open artifact is missing out/preload/index.js')
}

const menuPanelPreload = readIfExists(join(preloadDir, 'menuPanel.js'))
if (!menuPanelPreload) {
  fail('open artifact is missing out/preload/menuPanel.js')
}

const providerWorker = readIfExists(join(mainDir, 'providerWorker.js'))
if (providerWorker) {
  fail('open artifact must not emit out/main/providerWorker.js; Services/provider work is closed source')
}

const forbiddenMainTerms = [
  'Broker mode',
  'Agent API Instructions',
  'Provider operation timed out',
  'Cloudflare token',
  'provider:test',
  'provider:list-saved',
  'provider:set-from-vault-field',
]

for (const term of forbiddenMainTerms) {
  if (mainIndex.includes(term)) {
    fail(`open main bundle contains forbidden provider term: ${term}`)
  }
}
for (const term of findPrivateIpcNamespaceLeaks(mainIndex)) {
  fail(`open main bundle contains forbidden private IPC channel: ${term}`)
}

for (const term of findPrivatePreloadIpcChannelLeaks(preloadIndex)) {
  fail(`open preload bundle contains forbidden private IPC channel: ${term}`)
}

const forbiddenMenuPanelPreloadTerms = [
  'auth:setup',
  'auth:password',
  'vault:mutate',
  'vault:backup',
  'project:scan',
  'provider:test',
  'vault:respond-request',
  'audit:read',
]

for (const term of forbiddenMenuPanelPreloadTerms) {
  if (menuPanelPreload.includes(term)) {
    fail(`open menu-panel preload contains forbidden privileged IPC channel: ${term}`)
  }
}

const forbiddenWorkerTerms = [
  'permission_groups',
  '/value',
  'Cloudflare token roll failed',
  'Creating a scoped token requires',
  'Revoking user-owned API tokens',
  'Revoking account-owned API tokens',
]

if (providerWorker) {
  for (const term of forbiddenWorkerTerms) {
    if (providerWorker.includes(term)) {
      fail(`open provider worker contains forbidden lifecycle implementation term: ${term}`)
    }
  }
}

const rendererJs = existsSync(rendererAssetsDir)
  ? readdirSync(rendererAssetsDir)
    .filter(file => file.endsWith('.js'))
    .map(file => ({ file, source: readIfExists(join(rendererAssetsDir, file)) }))
  : []

if (rendererJs.length === 0) {
  fail('open artifact is missing renderer JavaScript assets')
}

const forbiddenRendererTerms = [
  'Broker mode',
  'Vault Broker',
  'Connect to Team Broker',
  'Continue with account',
  'Managed OAuth',
  'cloud sync',
  'Spend dashboards',
]

for (const { file, source } of rendererJs) {
  for (const term of findPrivateIpcNamespaceLeaks(source)) {
    fail(`open renderer bundle ${file} contains forbidden private IPC channel: ${term}`)
  }
  for (const term of forbiddenRendererTerms) {
    if (source.includes(term)) {
      fail(`open renderer bundle ${file} contains forbidden provider UI/API term: ${term}`)
    }
  }
}

const rendererSource = rendererJs.map(({ source }) => source).join('\n')
const requiredOpenThemeTerms = [
  'darkGrey',
  'opacity-28',
  'mix-blend-screen',
  'rgba(210,220,214,0.052)',
  'rgba(210,220,214,0.055)',
]

for (const term of requiredOpenThemeTerms) {
  if (!rendererSource.includes(term)) {
    fail(`open renderer bundle is missing the Community auth backdrop contract term: ${term}`)
  }
}

if (rendererSource.includes('liquid-noise')) {
  fail('open renderer bundle contains the closed-app liquid-noise visual layer')
}

if (failures.length > 0) {
  console.error('Open artifact checks failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('Open artifact checks passed.')
