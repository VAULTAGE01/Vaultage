import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

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

const forbiddenPreloadTerms = [
  'provider:test',
  'provider:list-saved',
  'provider:set-from-vault-field',
  'provider:delete-saved',
  'provider:cf-permissions-saved',
  'provider:cf-create-token-saved',
  'provider:cf-roll-token-saved',
  'feedback:provider-vote',
  'vault:copy-agent-instructions',
  'vault:get-agent-api-config',
  'vault:set-agent-api-port',
  'vault:set-api-enabled',
  'vault:incoming-request',
  'vault:respond-request',
  'vault:confirm-request-approval',
]

for (const term of forbiddenPreloadTerms) {
  if (preloadIndex.includes(term)) {
    fail(`open preload bundle contains forbidden private IPC channel: ${term}`)
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
  for (const term of forbiddenRendererTerms) {
    if (source.includes(term)) {
      fail(`open renderer bundle ${file} contains forbidden provider UI/API term: ${term}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Open artifact checks failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('Open artifact checks passed.')
