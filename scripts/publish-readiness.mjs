import { existsSync, readFileSync } from 'fs'

const blockers = []
const warnings = []

function fileContains(path, text) {
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8').includes(text)
}

const hasLicense = existsSync('LICENSE')

if (!hasLicense) {
  blockers.push('LICENSE is missing. Public Community source drops must include Apache-2.0.')
} else if (!fileContains('LICENSE', 'Apache License')) {
  blockers.push('LICENSE is present but does not look like Apache-2.0.')
}

if (hasLicense && existsSync('package.json') && !fileContains('package.json', '"license": "Apache-2.0"')) {
  blockers.push('package.json must declare "license": "Apache-2.0" in the public source drop.')
}

if (!existsSync('TRADEMARK.md')) {
  blockers.push('TRADEMARK.md is missing. Public source drops must document brand and official-build boundaries.')
}

if (!existsSync('.github/dependabot.yml')) {
  blockers.push('.github/dependabot.yml is missing. Public Community source drops should keep dependency update automation configured.')
}

if (!existsSync('DISCLAIMER.md')) {
  blockers.push('DISCLAIMER.md is missing. Public source drops must document warranty, liability, and misuse boundaries.')
}

if (!existsSync('NOTICE')) {
  blockers.push('NOTICE is missing. Public source drops must identify the project owner and source-drop boundary.')
}

if (existsSync('.env')) {
  blockers.push('Root .env exists. Delete local secret files and scrub history before publication.')
}

if (existsSync('dist')) {
  warnings.push('dist/ exists. Remove generated release artifacts from the public source drop.')
}

if (existsSync('out')) {
  warnings.push('out/ exists. Remove generated build output from the public source drop.')
}

if (existsSync('node_modules')) {
  warnings.push('node_modules/ exists. Remove installed dependencies from the public source drop.')
}

if (existsSync('resources/vault-keychain')) {
  warnings.push('resources/vault-keychain exists. Rebuild it during packaging; do not include generated helper binaries in source drops.')
}

if (existsSync('reports')) {
  blockers.push('reports/ is present. Public Community source drops must not include internal reports or launch-planning notes.')
}

const forbiddenFeatureFiles = [
  ['bin/vaultage.mjs', 'Public Community source drops must not include the Agent CLI.'],
  ['schemas/agent-request.v0.schema.json', 'Public Community source drops must not include Agent protocol schemas.'],
  ['schemas/agent-response.v0.schema.json', 'Public Community source drops must not include Agent protocol schemas.'],
  ['scripts/clean-source-drop.mjs', 'Public Community source drops must not include private source-drop maintenance scripts.'],
  ['scripts/prepare-public-repo.mjs', 'Public Community source drops must not include private repo extraction scripts.'],
  ['scripts/provider-worker-smoke.mjs', 'Public Community source drops must not include private provider-worker smoke tests.'],
  ['scripts/stage-open-source.mjs', 'Public Community source drops must not include private source staging scripts.'],
  ['scripts/verify-open-source-stage.mjs', 'Public Community source drops must not include private source staging verification scripts.'],
  ['src/cli/index.ts', 'Public Community source drops must not include the Agent CLI source.'],
  ['src/main/agentAuthToken.ts', 'Public Community source drops must not include Agent API token management.'],
  ['src/main/agentIpc.ts', 'Public Community source drops must use the disabled Agent IPC shim.'],
  ['src/main/agentRelease.ts', 'Public Community source drops must not include Agent secret-release implementation.'],
  ['src/main/agentServer.ts', 'Public Community source drops must not include the Agent HTTP server.'],
  ['src/main/providerBasicOps.ts', 'Public Community source drops must not include provider operation implementation.'],
  ['src/main/providerIpc.ts', 'Public Community source drops must use the disabled provider IPC shim.'],
  ['src/main/providerIpc.open.ts', 'Public Community source drops must not include provider IPC.'],
  ['src/main/providerLifecycleOps.ts', 'Public Community source drops must exclude Pro lifecycle automation implementation.'],
  ['src/main/providerRpc.ts', 'Public Community source drops must not include provider RPC schemas.'],
  ['src/main/providerWorker.ts', 'Public Community source drops must not include provider workers.'],
  ['src/main/providerWorkerClient.ts', 'Public Community source drops must use the disabled provider worker client shim.'],
  ['src/renderer/src/components/AddSecretModal.tsx', 'Public Community source drops must use the Community add-secret modal.'],
  ['src/renderer/src/components/AddProviderModal.tsx', 'Public Community source drops must not include Services setup UI.'],
  ['src/renderer/src/components/AgentView.tsx', 'Public Community source drops must not include private Agent/Projects dashboard source.'],
  ['src/renderer/src/components/CreateCloudflareTokenModal.tsx', 'Public Community source drops must not include token lifecycle UI.'],
  ['src/renderer/src/components/IntegrationsView.tsx', 'Public Community source drops must not include the Services tab.'],
  ['src/renderer/src/components/MainLayout.tsx', 'Public Community source drops must use the Community main layout.'],
  ['src/renderer/src/components/ModeSwitcher.tsx', 'Public Community source drops must use the Community mode switcher.'],
  ['src/renderer/src/components/ProvidersModal.tsx', 'Public Community source drops must not include Services/provider UI.'],
  ['src/renderer/src/components/SecretDetail.tsx', 'Public Community source drops must use the Community secret detail component.'],
  ['src/renderer/src/components/SecretRequestPanel.tsx', 'Public Community source drops must not include Agent request approval UI.'],
  ['src/renderer/src/components/Sidebar.tsx', 'Public Community source drops must use the Community sidebar.'],
  ['src/renderer/src/lib/providerVotes.ts', 'Public Community source drops must not include provider catalog voting.'],
  ['src/renderer/src/lib/serviceCategories.ts', 'Public Community source drops must use the disabled service catalog shim.'],
  ['src/renderer/src/modeContext.tsx', 'Public Community source drops must use the Community mode context.'],
  ['src/renderer/src/components/UsageMapView.tsx', 'Public Community source drops must not include provider-adjacent usage-map source.'],
  ['docs/decisions.md', 'Public Community source drops should use generated Community docs, not private ADR history.'],
  ['docs/design-system.md', 'Public Community source drops should not include private full-product design-system docs.'],
  ['docs/feedback.md', 'Public Community source drops should not include private feedback/provider-roadmap intake docs.'],
  ['docs/onboarding-research.md', 'Public Community source drops should not include private product-research docs.'],
  ['.github/workflows/release.yml', 'Public Community source drops must not include private signing/notarization release workflows.'],
]

for (const [path, message] of forbiddenFeatureFiles) {
  if (existsSync(path)) blockers.push(`${path} is present. ${message}`)
}

if (
  fileContains('SECURITY.md', 'public security contact is created') ||
  fileContains('SECURITY.md', 'public security contact is not finalized') ||
  !fileContains('SECURITY.md', 'security@vaultage.dev')
) {
  blockers.push('SECURITY.md still lacks a real monitored security contact.')
}

if (fileContains('README.md', 'No public license has been selected yet')) {
  blockers.push('README.md still says no public license has been selected.')
}

if (!fileContains('package.json', '"build:open-local"')) {
  blockers.push('Missing public Community build target.')
}

if (fileContains('.github/workflows/ci.yml', 'verify:open-source-stage')) {
  blockers.push('Public Community CI must run the Community package gate directly, not private source-drop staging.')
}

if (
  fileContains('.github/workflows/ci.yml', 'APPLE_ID') ||
  fileContains('.github/workflows/ci.yml', 'CSC_LINK') ||
  fileContains('README.md', 'vaultage-security-remediation-roadmap') ||
  fileContains('README.md', 'vaultage-release-security-checklist') ||
  fileContains('README.md', 'vaultage-publishing-readiness-assessment') ||
  fileContains('README.md', 'smoke:provider-worker') ||
  fileContains('docs/ci-cd.md', 'APPLE_ID') ||
  fileContains('docs/ci-cd.md', 'CSC_LINK') ||
  fileContains('docs/ci-cd.md', 'release-gates') ||
  fileContains('docs/ci-cd.md', 'open-source-gates') ||
  fileContains('docs/repo-structure.md', 'prepare:public-repo') ||
  fileContains('docs/repo-structure.md', 'verify:open-source-stage') ||
  fileContains('docs/README.md', '../reports/') ||
  fileContains('docs/repo-structure.md', '`reports`') ||
  fileContains('docs/release-provenance.md', 'verify:open-source-stage') ||
  fileContains('README.md', './reports/') ||
  fileContains('package.json', '"stage:open-source"') ||
  fileContains('package.json', '"verify:open-source-stage"') ||
  fileContains('package.json', '"prepare:public-repo"') ||
  fileContains('package.json', '"smoke:provider-worker"')
) {
  blockers.push('Public Community docs/CI still contain private release, staging, or provider-worker references.')
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
  if (fileContains('src/preload/index.ts', term)) {
    blockers.push(`src/preload/index.ts exposes private IPC channel ${term}.`)
  }
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`)
}

if (blockers.length > 0) {
  console.error('\nPublish readiness blockers:')
  for (const blocker of blockers) console.error(`- ${blocker}`)
  process.exit(1)
}

console.log('No publish-readiness blockers found.')
