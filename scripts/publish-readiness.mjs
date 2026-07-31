import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import {
  findPrivatePreloadIpcChannelLeaks,
  findPrivatePreloadModuleImportLeaks,
  isPrivateOverlaySourcePath,
} from './open-source-config.mjs'
import { validateLocalPackageTargets } from './script-targets.mjs'

const blockers = []
const warnings = []

for (const failure of validateLocalPackageTargets(process.cwd())) {
  blockers.push(`Package target validation: ${failure}`)
}

function sourcePaths(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourcePaths(path, files)
    else if (entry.isFile()) files.push(relative(process.cwd(), path).split('\\').join('/'))
    else if (entry.isSymbolicLink()) blockers.push(`Community source drops must not contain symbolic links: ${relative(process.cwd(), path)}`)
  }
  return files
}

for (const rootPath of ['src', 'browser-extension', 'bin', 'schemas']) {
  for (const path of sourcePaths(join(process.cwd(), rootPath))) {
    if (isPrivateOverlaySourcePath(path)) {
      blockers.push(`${path} is a private overlay path and must not be present in a Community source drop.`)
    }
  }
}

function fileContains(path, text) {
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8').includes(text)
}

for (const path of [
  'src/renderer/src/types.ts',
  'src/shared/vaultIpcContracts.ts',
  'src/shared/vaultValidation.ts',
]) {
  if (
    existsSync(path) &&
    /PaidBetaOnboarding|paidBetaOnboarding/u.test(readFileSync(path, 'utf8'))
  ) {
    blockers.push(`${path} contains private paid-beta onboarding metadata.`)
  }
}

if (
  existsSync('src/renderer/src/components/OnboardingResearchPrompt.open.tsx') &&
  /paid.?beta|agentClient|extensionChoice|Pro credit/iu.test(
    readFileSync(
      'src/renderer/src/components/OnboardingResearchPrompt.open.tsx',
      'utf8',
    ),
  )
) {
  blockers.push(
    'Community onboarding research UI contains private paid-beta choices or claims.',
  )
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
  ['scripts/check-browser-extension.mjs', 'Public Community source drops must not include private browser extension checks.'],
  ['scripts/browser-extension-artifact-lib.mjs', 'Public Community source drops must not include private browser extension packaging.'],
  ['scripts/browser-extension-artifact-lib.test.mjs', 'Public Community source drops must not include private browser extension packaging tests.'],
  ['scripts/build-browser-extension.mjs', 'Public Community source drops must not include private browser extension packaging.'],
  ['scripts/check-browser-extension-artifact.mjs', 'Public Community source drops must not include private browser extension artifact checks.'],
  ['scripts/build-extension-native-host.sh', 'Public Community source drops must not include private browser extension host builds.'],
  ['scripts/test-extension-native-host.mjs', 'Public Community source drops must not include private browser extension host tests.'],
  ['scripts/control-release-evidence-lib.mjs', 'Public Community source drops must not include private Control release evidence validation.'],
  ['scripts/check-extension-store-release.mjs', 'Public Community source drops must not include private extension Store release validation.'],
  ['scripts/extension-store-release-evidence-lib.mjs', 'Public Community source drops must not include private extension Store release evidence validation.'],
  ['scripts/chrome-web-store-operator.mjs', 'Public Community source drops must not include the private Chrome Web Store operator.'],
  ['scripts/check-extension-store-workflows.mjs', 'Public Community source drops must not include private extension Store workflow policy.'],
  ['scripts/chrome-web-store-api.mjs', 'Public Community source drops must not include the private Chrome Web Store API client.'],
  ['scripts/chrome-web-store-api.test.mjs', 'Public Community source drops must not include private Chrome Web Store API tests.'],
  ['scripts/materialize-store-operator-inputs.mjs', 'Public Community source drops must not include private Store credential materialization.'],
  ['scripts/reserve-store-authorization.mjs', 'Public Community source drops must not include private Store authorization reservation.'],
  ['scripts/store-workflow-evidence.test.mjs', 'Public Community source drops must not include private Store workflow evidence tests.'],
  ['scripts/verify-store-source-run.mjs', 'Public Community source drops must not include private Store source-run verification.'],
  ['scripts/stage-open-source.mjs', 'Public Community source drops must not include private source staging scripts.'],
  ['scripts/verify-open-source-stage.mjs', 'Public Community source drops must not include private source staging verification scripts.'],
  ['src/cli/index.ts', 'Public Community source drops must not include the Agent CLI source.'],
  ['src/main/agentAuthToken.ts', 'Public Community source drops must not include Agent API token management.'],
  ['src/main/agentIpc.ts', 'Public Community source drops must use the disabled Agent IPC shim.'],
  ['src/main/agentRelease.ts', 'Public Community source drops must not include Agent secret-release implementation.'],
  ['src/main/agentServer.ts', 'Public Community source drops must not include the Agent HTTP server.'],
  ['src/main/extensionHandoff.ts', 'Public Community source drops must not include browser-extension handoff implementation.'],
  ['src/main/extensionHandoff.test.ts', 'Public Community source drops must not include browser-extension handoff tests or fixtures.'],
  ['src/main/browserExtensionIdentity.ts', 'Public Community source drops must not include browser-extension identity policy.'],
  ['src/main/browserExtensionIdentity.test.ts', 'Public Community source drops must not include browser-extension identity policy tests.'],
  ['src/main/browserExtensionNativeHostRegistrar.ts', 'Public Community source drops must not include browser-extension host registration.'],
  ['src/main/browserExtensionNativeHostRegistrar.test.ts', 'Public Community source drops must not include browser-extension host registration tests.'],
  ['src/main/browserExtensionPairingController.ts', 'Public Community source drops must not include browser-extension pairing controller.'],
  ['src/main/browserExtensionPairingController.test.ts', 'Public Community source drops must not include browser-extension pairing controller tests.'],
  ['src/main/browserExtensionPairingControllerSupport.ts', 'Public Community source drops must not include browser-extension pairing controller support.'],
  ['src/main/browserExtensionPairingFileStore.ts', 'Public Community source drops must not include browser-extension pairing file store.'],
  ['src/main/browserExtensionPairingFileStore.test.ts', 'Public Community source drops must not include browser-extension pairing file store tests.'],
  ['src/main/browserExtensionPairingHttp.ts', 'Public Community source drops must not include browser-extension pairing HTTP transport.'],
  ['src/main/browserExtensionPairingHttp.test.ts', 'Public Community source drops must not include browser-extension pairing HTTP tests.'],
  ['src/main/browserExtensionPairingSchema.ts', 'Public Community source drops must not include browser-extension pairing schema.'],
  ['src/main/browserExtensionPairingSchema.test.ts', 'Public Community source drops must not include browser-extension pairing schema tests.'],
  ['src/main/browserExtensionPairingStore.ts', 'Public Community source drops must not include browser-extension pairing store.'],
  ['src/main/browserExtensionPairingStore.test.ts', 'Public Community source drops must not include browser-extension pairing store tests.'],
  ['src/preload/browserExtensionBridge.ts', 'Public Community source drops must not include the browser-extension preload bridge.'],
  ['src/preload/browserExtensionBridge.test.ts', 'Public Community source drops must not include browser-extension preload bridge tests.'],
  ['src/shared/browserExtensionContracts.ts', 'Public Community source drops must not publish browser-extension IPC contracts.'],
  ['src/shared/extensionPairingIpcContracts.ts', 'Public Community source drops must not publish extension pairing IPC contracts.'],
  ['src/shared/extensionPairingIpcContracts.test.ts', 'Public Community source drops must not publish extension pairing IPC contract tests.'],
  ['src/preload/extensionPairingBridge.ts', 'Public Community source drops must not include the extension pairing preload bridge.'],
  ['src/preload/extensionPairingBridge.test.ts', 'Public Community source drops must not include extension pairing preload bridge tests.'],
  ['src/renderer/src/hooks/useExtensionPairing.ts', 'Public Community source drops must not include extension pairing renderer hooks.'],
  ['src/renderer/src/hooks/useExtensionPairing.test.ts', 'Public Community source drops must not include extension pairing renderer hook tests.'],
  ['src/renderer/src/components/ExtensionPairingPanel.tsx', 'Public Community source drops must not include browser-extension pairing UI.'],
  ['src/renderer/src/components/ExtensionPairingPanel.test.tsx', 'Public Community source drops must not include browser-extension pairing UI tests.'],
  ['browser-extension/extension/pairing-identity.js', 'Public Community source drops must not include browser-extension pairing identity.'],
  ['browser-extension/extension/pairing-identity.test.mjs', 'Public Community source drops must not include browser-extension pairing identity tests.'],
  ['browser-extension/native-host/pairing-dispatch.mjs', 'Public Community source drops must not include signed pairing dispatch.'],
  ['browser-extension/native-host/pairing-dispatch.test.mjs', 'Public Community source drops must not include signed pairing dispatch tests.'],
  ['browser-extension/native-host/pairing-protocol.mjs', 'Public Community source drops must not include pairing protocol implementation.'],
  ['browser-extension/native-host/pairing-record.mjs', 'Public Community source drops must not include authenticated pairing record verification.'],
  ['browser-extension/native-host/pairing-state.mjs', 'Public Community source drops must not include pairing state implementation.'],
  ['browser-extension/native-host/pairing-test-fixture.mjs', 'Public Community source drops must not include pairing test fixtures.'],
  ['browser-extension/native-host/pairing-verifier.mjs', 'Public Community source drops must not include pairing signature verification.'],
  ['browser-extension/native-host/pairing-verifier.test.mjs', 'Public Community source drops must not include pairing verifier tests.'],
  ['scripts/check-browser-extension-pairing.mjs', 'Public Community source drops must not include private pairing architecture checks.'],
  ['src/main/providerBasicOps.ts', 'Public Community source drops must not include provider operation implementation.'],
  ['src/main/providerHttp.ts', 'Public Community source drops must not include provider HTTP implementation helpers.'],
  ['src/main/providerIpc.ts', 'Public Community source drops must use the disabled provider IPC shim.'],
  ['src/main/providerLifecycleOps.ts', 'Public Community source drops must exclude Pro lifecycle automation implementation.'],
  ['src/main/providerRpc.ts', 'Public Community source drops must not include provider RPC schemas.'],
  ['src/main/providerWorker.ts', 'Public Community source drops must not include provider workers.'],
  ['src/main/providerWorkerClient.ts', 'Public Community source drops must use the disabled provider worker client shim.'],
  ['src/renderer/src/components/AddSecretModal.tsx', 'Public Community source drops must use the Community add-secret modal.'],
  ['src/renderer/src/components/AddProviderModal.tsx', 'Public Community source drops must not include Services setup UI.'],
  ['src/renderer/src/components/AgentView.tsx', 'Public Community source drops must not include private Agent/Projects dashboard source.'],
  ['src/renderer/src/components/CreateCloudflareTokenModal.tsx', 'Public Community source drops must not include token lifecycle UI.'],
  ['src/renderer/src/components/ExtensionSaveCandidatePanel.tsx', 'Public Community source drops must not include browser-extension save approval UI.'],
  ['src/renderer/src/components/IntegrationsView.tsx', 'Public Community source drops must not include the Services tab.'],
  ['src/renderer/src/components/LegacyMainContent.tsx', 'Public Community source drops must use the Community main-content composition.'],
  ['src/renderer/src/components/LegacyMainContent.test.ts', 'Public Community source drops must not include closed main-content routing tests.'],
  ['src/renderer/src/components/legacyMainContentRoute.ts', 'Public Community source drops must not include a dormant Services route.'],
  ['src/renderer/src/components/MainLayout.tsx', 'Public Community source drops must use the Community main layout.'],
  ['src/renderer/src/components/ModeSwitcher.tsx', 'Public Community source drops must use the Community mode switcher.'],
  ['src/renderer/src/components/ModeSwitcher.test.tsx', 'Public Community source drops must not include closed mode-switcher tests.'],
  ['src/renderer/src/components/OnboardingResearchPrompt.tsx', 'Public Community source drops must use the Community-only research prompt.'],
  ['src/renderer/src/components/PaidBetaOnboarding.tsx', 'Public Community source drops must not include paid-beta onboarding implementation.'],
  ['src/renderer/src/components/PaidBetaOnboardingOptions.tsx', 'Public Community source drops must not include paid-beta onboarding choices.'],
  ['src/renderer/src/components/ProvidersModal.tsx', 'Public Community source drops must not include Services/provider UI.'],
  ['src/renderer/src/components/officialProviderBrandAssets.ts', 'Public Community source drops must not include private provider brand catalog metadata.'],
  ['src/renderer/src/components/PinnedVaultLists.tsx', 'Public Community source drops must use the Community pinned Vault list.'],
  ['src/renderer/src/components/PinnedVaultLists.test.tsx', 'Public Community source drops must not include closed dashboard-model tests.'],
  ['src/renderer/src/components/ProjectsGuidanceHero.tsx', 'Public Community source drops must use the local-only Community Projects guidance.'],
  ['src/renderer/src/components/ProjectsGuidanceHero.test.tsx', 'Public Community source drops must not include closed Projects guidance tests.'],
  ['src/renderer/src/components/ProjectsGuidancePlacement.test.mjs', 'Public Community source drops must not include closed Projects placement tests.'],
  ['src/renderer/src/components/SecretDashboardModals.tsx', 'Public Community source drops must not include closed dashboard modals.'],
  ['src/renderer/src/components/SecretDetail.tsx', 'Public Community source drops must use the Community secret detail component.'],
  ['src/renderer/src/components/SecretLifecycleModals.tsx', 'Public Community source drops must not include Services/Agent lifecycle UI.'],
  ['src/renderer/src/components/SecretLocalDashboard.tsx', 'Public Community source drops must use the Community dashboard component.'],
  ['src/renderer/src/components/SecretLocalDashboardModel.ts', 'Public Community source drops must not include closed dashboard model metadata.'],
  ['src/renderer/src/components/SecretLocalDashboardModel.test.ts', 'Public Community source drops must not include closed dashboard model tests.'],
  ['src/renderer/src/components/SecretRequestPanel.tsx', 'Public Community source drops must not include Agent request approval UI.'],
  ['src/renderer/src/components/SettingsModal.tsx', 'Public Community source drops must not advertise private settings controls that the Community shell does not expose.'],
  ['src/renderer/src/components/Sidebar.tsx', 'Public Community source drops must use the Community sidebar.'],
  ['src/renderer/src/lib/providerCapabilities.ts', 'Public Community source drops must not include provider capability catalog metadata.'],
  ['src/renderer/src/lib/providerResearch.ts', 'Public Community source drops must not include provider research catalog metadata.'],
  ['src/renderer/src/lib/providerResearch.test.ts', 'Public Community source drops must not include provider research catalog tests.'],
  ['src/renderer/src/lib/providerVotes.ts', 'Public Community source drops must not include provider catalog voting.'],
  ['src/renderer/src/lib/paidBetaOnboarding.ts', 'Public Community source drops must not include paid-beta onboarding state logic.'],
  ['src/renderer/src/lib/paidBetaOnboarding.test.ts', 'Public Community source drops must not include paid-beta onboarding tests.'],
  ['src/renderer/src/lib/serviceCategories.ts', 'Public Community source drops must use the disabled service catalog shim.'],
  ['src/renderer/src/modeContext.tsx', 'Public Community source drops must use the Community mode context.'],
  ['src/shared/agentIpcContracts.ts', 'Public Community source drops must not publish private Agent IPC contracts.'],
  ['src/shared/agentIpcContracts.test.ts', 'Public Community source drops must not publish private Agent contract tests.'],
  ['src/shared/providerIpcContracts.ts', 'Public Community source drops must not publish private provider IPC contracts.'],
  ['src/shared/ipcContractSurface.test.ts', 'Public Community source drops must not publish aggregate tests for private IPC surfaces.'],
  ['src/renderer/src/components/UsageMapView.tsx', 'Public Community source drops must not include provider-adjacent usage-map source.'],
  ['browser-extension/extension/manifest.json', 'Public Community source drops must not include the closed browser extension.'],
  ['browser-extension/native-host/vaultage-native-host.mjs', 'Public Community source drops must not include the closed browser extension native host.'],
  ['docs/decisions.md', 'Public Community source drops should use generated Community docs, not private ADR history.'],
  ['docs/design-system.md', 'Public Community source drops should not include private full-product design-system docs.'],
  ['docs/feedback.md', 'Public Community source drops should not include private feedback/provider-roadmap intake docs.'],
  ['docs/onboarding-research.md', 'Public Community source drops should not include private product-research docs.'],
  ['.github/workflows/release.yml', 'Public Community source drops must not include private signing/notarization release workflows.'],
  ['.github/workflows/extension-store-publish.yml', 'Public Community source drops must not include private extension Store lifecycle workflows.'],
  ['.github/workflows/extension-store-upload.yml', 'Public Community source drops must not include private extension Store upload workflows.'],
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

if (
  fileContains('package.json', '"name": "vaultage-open-local"') &&
  fileContains('electron-builder.yml', 'browser-extension')
) {
  blockers.push('Public Community electron-builder.yml must not reference closed browser-extension resources.')
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
  fileContains('CONTRIBUTING.md', 'verify:open-source-stage') ||
  fileContains('README.md', './reports/') ||
  fileContains('package.json', '"stage:open-source"') ||
  fileContains('package.json', '"verify:open-source-stage"') ||
  fileContains('package.json', '"prepare:public-repo"') ||
  fileContains('package.json', '"smoke:provider-worker"')
) {
  blockers.push('Public Community docs/CI still contain private release, staging, or provider-worker references.')
}

const preloadSource = existsSync('src/preload/index.ts')
  ? readFileSync('src/preload/index.ts', 'utf8')
  : ''
for (const term of findPrivatePreloadIpcChannelLeaks(preloadSource)) {
  blockers.push(`src/preload/index.ts exposes private IPC channel ${term}.`)
}
for (const term of findPrivatePreloadModuleImportLeaks(preloadSource)) {
  blockers.push(`src/preload/index.ts imports private browser-extension module ${term}.`)
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
