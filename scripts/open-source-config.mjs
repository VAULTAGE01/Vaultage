// New files in closed feature families are private by default. Only explicit
// `.disabled.*` compile seams survive Community staging.
const privateOverlaySourcePatterns = [
  /^browser-extension\//,
  /^bin\/vaultage\.mjs$/,
  /^bin\/vaultage-mcp\.mjs$/,
  /^docs\/mcp\.md$/,
  /^docs\/roadmap(?:\/|$)/,
  /^schemas\/agent-[^/]+\.schema\.json$/,
  /^scripts\/linear-roadmap(?:\/|$)/,
  /^scripts\/run-agent-user-presence-benchmark(?:\.test\.mjs|\.sh)$/,
  /^scripts\/services-ui-e2e\.mjs$/,
  /^scripts\/services-provider-flow-visual-qa\.mjs$/,
  /^scripts\/product-flow-composition\.test\.ts$/,
  /^scripts\/check-browser-extension-pairing(?:\.test)?\.mjs$/,
  /^scripts\/mcp-demo\.mjs$/,
  /^src\/cli\//,
  /^src\/main\/mcp[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/main\/(?:cloudflare|providers)(?:\/|$)/,
  // Browser-extension pairing is a private trust boundary. Keep both the
  // current leaf modules and future nested/private siblings out of Community.
  /^src\/main\/browserExtension(?:Pairing|Identity|NativeHost)(?:\/|[^/]*\.[cm]?[jt]sx?$)/,
  /^src\/shared\/browserExtensionContracts(?:\/|[^/]*\.[cm]?[jt]sx?$)/,
  /^src\/shared\/extensionPairingIpcContracts(?:\/|[^/]*\.[cm]?[jt]sx?$)/,
  /^src\/preload\/browserExtensionBridge(?:\/|[^/]*\.[cm]?[jt]sx?$)/,
  /^src\/preload\/extensionPairingBridge(?:\/|[^/]*\.[cm]?[jt]sx?$)/,
  /^src\/renderer\/src\/hooks\/useExtensionPairing(?:\/|[^/]*\.[cm]?[jt]sx?$)/,
  /^src\/main\/(?:agent|commercial|extension|provider)[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/main\/nativeUserPresence(?:\.test)?\.ts$/,
  /^src\/shared\/(?:agent|commercial|extension|provider)[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/shared\/awsProjectEnvironment(?:\/|[^/]*\.[cm]?[jt]sx?$)/i,
  /^src\/renderer\/.*\/(?:Agent|Aws|Commercial|Extension|Integration|Provider|Service|UsageMap)[^/]*\.[cm]?[jt]sx?$/,
  /^src\/renderer\/.*\/(?:agent|commercial|extension|integration|provider|service)[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/renderer\/.*\/(?:PaidBeta|paidBeta)[^/]*\.[cm]?[jt]sx?$/,
  /^src\/renderer\/src\/components\/SettingsModal\.tsx$/,
  /^src\/renderer\/src\/components\/ModalLayoutContracts\.test\.mjs$/,
]

// UI2026 .open files below are explicit manual ports of official Community
// main 698e3424a1867722c5542ff5b7e1e9344b867630. They intentionally do not
// replace closed/private counterparts with the same conceptual surface, so
// this boundary is not reversible reconciliation provenance.
export const publicUi2026SourcePaths = new Set([
  'src/renderer/src/ui2026/assets/projects-hero.png',
  'src/renderer/src/ui2026/assets/open.ts',
  'src/renderer/src/ui2026/flags.test.ts',
  'src/renderer/src/ui2026/flags.ts',
  'src/renderer/src/ui2026/focusRestoration.test.ts',
  'src/renderer/src/ui2026/focusRestoration.ts',
  'src/renderer/src/ui2026/primitives.open.test.tsx',
  'src/renderer/src/ui2026/primitives.open.tsx',
  'src/renderer/src/ui2026/primitives/cards.open.tsx',
  'src/renderer/src/ui2026/primitives/hero.tsx',
  'src/renderer/src/ui2026/primitives/rail.tsx',
  'src/renderer/src/ui2026/primitives/rows.tsx',
  'src/renderer/src/ui2026/primitives/shell.tsx',
  'src/renderer/src/ui2026/primitives/types.ts',
  'src/renderer/src/ui2026/referenceComposition.tsx',
  'src/renderer/src/ui2026/surfaceNavigation.test.tsx',
  'src/renderer/src/ui2026/surfaceNavigation.tsx',
  'src/renderer/src/ui2026/surfaceSearch.ts',
  'src/renderer/src/ui2026/surfaces/ProjectsSurface.open.test.tsx',
  'src/renderer/src/ui2026/surfaces/ProjectsSurface.open.tsx',
  'src/renderer/src/ui2026/surfaces/projectsModel.open.test.ts',
  'src/renderer/src/ui2026/surfaces/projectsModel.open.ts',
  'src/renderer/src/ui2026/surfaces/projectsSurface.open.css',
  'src/renderer/src/ui2026/surfaces/VaultDashboard.open.tsx',
  'src/renderer/src/ui2026/surfaces/VaultReferenceRail.open.tsx',
  'src/renderer/src/ui2026/surfaces/VaultSearchPanel.open.tsx',
  'src/renderer/src/ui2026/surfaces/VaultSurface.open.css',
  'src/renderer/src/ui2026/surfaces/VaultSurface.open.test.tsx',
  'src/renderer/src/ui2026/surfaces/VaultSurface.open.tsx',
  'src/renderer/src/ui2026/surfaces/vaultSurfaceActions.open.test.ts',
  'src/renderer/src/ui2026/surfaces/vaultSurfaceActions.open.ts',
  'src/renderer/src/ui2026/surfaces/vaultSurfaceModel.open.test.ts',
  'src/renderer/src/ui2026/surfaces/vaultSurfaceModel.open.ts',
  'src/renderer/src/ui2026/ui2026.css',
])

// Community changes are not mirrored wholesale into the private product. The
// reconciliation tool accepts only these public Vault/Projects source files,
// and then only when the public baseline blob is byte-identical to the private
// source commit recorded in the sync ledger. Files rewritten by staging remain
// intentionally non-reversible and require a manual private port.
export const communityReconciliableSourcePatterns = Object.freeze([
  /^src\/main\/(?:project(?:Ipc|Scanner|Scan|MappingPolicy)|vault(?:Ipc|DataIpc|SecretIpc|CommandMutations|Mutations|Storage|UsageBatcher|SessionIpc)|audit|auth|envFile)(?:\.test)?\.ts$/u,
  /^src\/shared\/(?:project|vault|secretAccessPolicy)[^/]*\.[cm]?[jt]sx?$/u,
  /^src\/renderer\/src\/components\/(?:MainLayout|ProjectsView|SecretDetail|Sidebar|CommunityProjectRow|CommunitySecretContext|CommunitySettingsModal|VaultFolderTree|PinnedVaultLists|ProjectsGuidanceHero|AddSecretModal)\.open(?:\.test)?\.tsx$/u,
  /^src\/renderer\/src\/hooks\/useCommunitySidebarShortcuts\.open(?:\.test)?\.ts$/u,
  /^src\/renderer\/src\/lib\/(?:projectEnvironments|projectMappingPolicy|projectActionPreviews|secretLifecycle|textInputRequests)\.ts$/u,
])

export function isCommunityReconciliableSourcePath(path) {
  const normalized = path.replaceAll('\\', '/')
  return publicUi2026SourcePaths.has(normalized)
    || communityReconciliableSourcePatterns.some(pattern => pattern.test(normalized))
}

// Disabled seams are public source, so every one must be reviewed explicitly.
// Never restore a blanket `*.disabled.*` exception: a closed implementation
// with a misleading suffix would then be copied into the Community source drop.
export const reviewedDisabledSeamPaths = new Set([
  'src/main/agentComposition.disabled.ts',
  'src/main/commercialRuntime.disabled.ts',
  'src/main/commercialStateStore.disabled.ts',
  'src/main/extensionCandidateVault.disabled.ts',
  'src/main/extensionNativeHostComposition.disabled.ts',
  'src/main/extensionNativeHostIpc.disabled.ts',
  'src/main/extensionHandoff.disabled.ts',
  'src/main/providerIpc.disabled.ts',
  'src/main/providerRecovery.disabled.ts',
  'src/main/providerBasicOps.disabled.ts',
  'src/main/providerLifecycleOps.disabled.ts',
  'src/main/providerVote.disabled.ts',
  'src/main/providerWorkerClient.disabled.ts',
  'src/renderer/src/commercialAccountContext.disabled.tsx',
  'src/renderer/src/components/AddProviderModal.disabled.tsx',
  'src/renderer/src/components/CommercialAccountSettings.disabled.tsx',
  'src/renderer/src/components/CommercialReadiness.disabled.tsx',
  'src/renderer/src/components/CreateCloudflareTokenModal.disabled.tsx',
  'src/renderer/src/components/IntegrationsView.disabled.tsx',
  'src/renderer/src/components/ProviderIcons.disabled.tsx',
  'src/renderer/src/components/SecretRequestPanel.disabled.tsx',
  'src/renderer/src/components/serviceCategoryIcons.disabled.tsx',
  'src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts',
  'src/renderer/src/lib/serviceCategories.disabled.ts',
])

export function isReviewedDisabledSeamPath(path) {
  return reviewedDisabledSeamPaths.has(path.replaceAll('\\', '/'))
}

export function isPrivateOverlaySourcePath(path) {
  const normalized = path.replaceAll('\\', '/')
  if (/\.disabled\.[cm]?[jt]sx?$/.test(normalized)) {
    return !isReviewedDisabledSeamPath(normalized)
  }
  if (normalized.startsWith('src/renderer/src/ui2026/')) {
    return !publicUi2026SourcePaths.has(normalized)
  }
  // Redaction is a Community security boundary too. Keep its provider-key
  // sensitivity policy even though provider connector implementations remain
  // private overlay sources.
  if (normalized === 'src/shared/providerConfigPolicy.ts') return false
  return privateOverlaySourcePatterns.some(pattern => pattern.test(normalized))
}

// All closed account, authentication, device, entitlement, billing, export,
// and privacy IPC must live below `commercial:`. Rejecting the namespace as a
// whole protects future channels and events without requiring every gate to be
// updated whenever the commercial API grows.
export const privatePreloadIpcChannelPrefixes = Object.freeze([
  'commercial:',
  'extension-native-host:',
])

export const privatePreloadIpcChannelTerms = Object.freeze([
  'provider:test',
  'provider:list-saved',
  'provider:set-from-vault-field',
  'provider:delete-saved',
  'provider:cf-permissions-saved',
  'provider:cf-create-token-saved',
  'provider:cf-roll-token-saved',
  'provider:aws-project-verify-target',
  'feedback:provider-vote',
  'vault:copy-agent-instructions',
  'vault:get-agent-access-policy',
  'vault:create-agent-client',
  'vault:revoke-agent-client',
  'vault:revoke-agent-auto-approval',
  'vault:get-agent-api-config',
  'vault:set-agent-api-port',
  'vault:set-api-enabled',
  'vault:incoming-request',
  'vault:respond-request',
  'vault:confirm-request-approval',
  'vault:extension-save-candidate',
  'vault:extension-save-candidate-expired',
  'vault:respond-extension-save-candidate',
  'vault:respond-extension-pairing',
  'vault:get-extension-pairing-status',
  'vault:unpair-extension-pairing',
  'vault:extension-pairing-request',
  'vault:extension-pairing-expired',
])

export function findPrivateIpcNamespaceLeaks(source) {
  return privatePreloadIpcChannelPrefixes.filter(prefix => source.includes(prefix))
}

export function findPrivatePreloadIpcChannelLeaks(source) {
  return [
    ...findPrivateIpcNamespaceLeaks(source),
    ...privatePreloadIpcChannelTerms,
  ].filter((term, index, terms) => source.includes(term) && terms.indexOf(term) === index)
}

const privatePreloadModuleImportPatterns = Object.freeze([
  ['browserExtensionBridge', /(?:from\s+|import\s*(?:\(\s*)?)['"][^'"]*browserExtensionBridge(?:\.[cm]?[jt]sx?)?['"]/u],
  ['browserExtensionContracts', /(?:from\s+|import\s*(?:\(\s*)?)['"][^'"]*browserExtensionContracts(?:\.[cm]?[jt]sx?)?['"]/u],
  ['extensionPairingBridge', /(?:from\s+|import\s*(?:\(\s*)?)['"][^'"]*extensionPairingBridge(?:\.[cm]?[jt]sx?)?['"]/u],
  ['extensionPairingIpcContracts', /(?:from\s+|import\s*(?:\(\s*)?)['"][^'"]*extensionPairingIpcContracts(?:\.[cm]?[jt]sx?)?['"]/u],
])

export function findPrivatePreloadModuleImportLeaks(source) {
  return privatePreloadModuleImportPatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([term]) => term)
}

// These names describe the private standing-grant trust boundary. Community
// may expose a fail-closed operational registrar, but must not publish or emit
// the authentication, mapping, policy, or auto-release composition itself.
export const privateAgentCompositionTerms = Object.freeze([
  'AgentAutoApprovalStore',
  'authenticateAgentClient',
  'tryAutoApproval',
  'createAutoApprovalGrant',
  'tokenFingerprint',
  'requestedKeys',
  'environmentScope',
  'grantId',
  'resolveAgentProjectRelease',
  'resolveAgentReleaseSelections',
  'agentEntryIdentities',
  'registerAgentIpc',
  'listAgentAccess',
  'createAgentClient',
  'revokeAgentClient',
  'revokeAgentAutoApproval',
])

export function findPrivateAgentCompositionLeaks(source) {
  return privateAgentCompositionTerms.filter(term => source.includes(term))
}

export const privateVaultValidationTerms = Object.freeze([
  'CloudflareTokenPolicyLineage',
  'cloudflarePolicyTargets',
  'cloudflareProviders',
  'cloudflareTokenPolicies',
  'maxCloudflarePermissionGroupsPerPolicy',
  'maxCloudflareScopesPerPermissionGroup',
  'maxCloudflareTokenPolicies',
  'validateCloudflareTokenPolicy',
  'validateCloudflareTokenPolicies',
  'validateCloudflareTokenPolicyLineage',
  'cf-api-token/v1',
])

const normalizedPrivateVaultValidationTerms = new Set(
  privateVaultValidationTerms.map(term => normalizePrivateVaultValidationTerm(term)),
)

function normalizePrivateVaultValidationTerm(term) {
  return term.toLowerCase().replaceAll(/[-_/]/gu, '')
}

export function findPrivateVaultValidationLeaks(source) {
  const sourceTerms = source.match(/\b[A-Za-z_][A-Za-z0-9_-]*(?:\/v[0-9]+)?\b/gu) ?? []
  return [...new Set(
    sourceTerms.filter(term => (
      normalizedPrivateVaultValidationTerms.has(normalizePrivateVaultValidationTerm(term))
    )),
  )]
}

export const openNodeAliasPaths = {
  '#agent-composition': ['src/main/agentComposition.disabled.ts'],
  '#extension-handoff': ['src/main/extensionHandoff.disabled.ts'],
  '#extension-candidate-vault': ['src/main/extensionCandidateVault.disabled.ts'],
  '#extension-native-host-composition': ['src/main/extensionNativeHostComposition.disabled.ts'],
  '#extension-native-host-ipc': ['src/main/extensionNativeHostIpc.disabled.ts'],
  '#provider-ipc': ['src/main/providerIpc.disabled.ts'],
  '#provider-recovery': ['src/main/providerRecovery.disabled.ts'],
  '#provider-vote': ['src/main/providerVote.disabled.ts'],
  '#provider-worker-client': ['src/main/providerWorkerClient.disabled.ts'],
  '#provider-basic-ops': ['src/main/providerBasicOps.disabled.ts'],
  '#provider-lifecycle-ops': ['src/main/providerLifecycleOps.disabled.ts'],
  '#commercial-runtime': ['src/main/commercialRuntime.disabled.ts'],
}

export const openWebAliasPaths = {
  '#add-provider-modal': ['src/renderer/src/components/AddProviderModal.disabled.tsx'],
  '#add-secret-modal': ['src/renderer/src/components/AddSecretModal.open.tsx'],
  '#create-cloudflare-token-modal': ['src/renderer/src/components/CreateCloudflareTokenModal.disabled.tsx'],
  '#integrations-view': ['src/renderer/src/components/IntegrationsView.disabled.tsx'],
  '#main-layout': ['src/renderer/src/components/MainLayout.open.tsx'],
  '#mode-context': ['src/renderer/src/modeContext.open.tsx'],
  '#mode-switcher': ['src/renderer/src/components/ModeSwitcher.open.tsx'],
  '#projects-view': ['src/renderer/src/components/ProjectsView.open.tsx'],
  '#provider-icons': ['src/renderer/src/components/ProviderIcons.disabled.tsx'],
  '#secret-detail': ['src/renderer/src/components/SecretDetail.open.tsx'],
  '#secret-request-panel': ['src/renderer/src/components/SecretRequestPanel.disabled.tsx'],
  '#service-categories': ['src/renderer/src/lib/serviceCategories.disabled.ts'],
  '#service-category-icons': ['src/renderer/src/components/serviceCategoryIcons.disabled.tsx'],
  '#sidebar': ['src/renderer/src/components/Sidebar.open.tsx'],
  '#commercial-readiness': ['src/renderer/src/components/CommercialReadiness.disabled.tsx'],
  '#commercial-capabilities': ['src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts'],
  '#commercial-account': ['src/renderer/src/commercialAccountContext.disabled.tsx'],
  '#commercial-account-settings': ['src/renderer/src/components/CommercialAccountSettings.disabled.tsx'],
}

export const openNodeTypecheckInclude = [
  'electron.vite.config.*',
  'src/main/**/*',
  'src/preload/**/*',
  'src/shared/**/*',
]

export const openNodeTypecheckExclude = [
  'src/cli/**/*',
  'src/main/**/*.test.ts',
  'src/main/agentComposition.ts',
  'src/main/agentAuthToken.ts',
  'src/main/agentAutoApproval.ts',
  'src/main/agentCredentialDepositComposition.ts',
  'src/main/agentCredentialDepositHttp.ts',
  'src/main/agentCredentialDepositRegistration.ts',
  'src/main/agentCredentialDepositVault.ts',
  'src/main/agentDiscovery.ts',
  'src/main/agentIpc.ts',
  'src/main/agentRelease.ts',
  'src/main/agentServer.ts',
  'src/main/extensionHandoff.ts',
  'src/main/extensionCandidateVault.ts',
  'src/main/extensionNativeHostComposition.ts',
  'src/main/extensionNativeHostIpc.ts',
  'src/main/providerAuthorization.ts',
  'src/main/providerBasicOps.ts',
  'src/main/providerEgress.ts',
  'src/main/providerHttp.ts',
  'src/main/providerIpc.ts',
  'src/main/providerLifecycleOps.ts',
  'src/main/providerNetworkPolicy.ts',
  'src/main/providerRecovery.ts',
  'src/main/providerRpc.ts',
  'src/main/providerVote.ts',
  'src/main/providerVaultMutations.ts',
  'src/main/providers.ts',
  'src/main/providerWorker.ts',
  'src/main/providerWorkerClient.ts',
  'src/preload/index.ts',
  'src/shared/ipcContractSurface.test.ts',
]

/** Removes the closed paid-release loader and literal injection from Vite config source. */
export function stripClosedReleaseConfiguration(source) {
  const patterns = [
    /\/\/ VAULTAGE_CLOSED_RELEASE_CONFIGURATION_START[\s\S]*?\/\/ VAULTAGE_CLOSED_RELEASE_CONFIGURATION_END\n/u,
    /\/\/ VAULTAGE_CLOSED_RELEASE_PROFILE_START[\s\S]*?\/\/ VAULTAGE_CLOSED_RELEASE_PROFILE_END\n/u,
  ]
  const definePattern = /\s*\/\/ VAULTAGE_CLOSED_RELEASE_DEFINE_START[\s\S]*?\/\/ VAULTAGE_CLOSED_RELEASE_DEFINE_END\n/u
  const markerMatches = [...patterns, definePattern].map(pattern => pattern.test(source))
  let result = source
  if (markerMatches.every(match => !match)) {
    if (/VAULTAGE_COMMERCIAL_RELEASE|__VAULTAGE_COMMERCIAL_RUNTIME_CONFIGURATION__|commercialRuntimeConfig/u.test(source)) {
      throw new Error('Unmarked closed release configuration remains in Community Vite config')
    }
  } else if (!markerMatches.every(Boolean)) {
    throw new Error('Closed release configuration markers are incomplete')
  } else {
    for (const pattern of patterns) {
      result = result.replace(pattern, '')
    }
    result = result.replace(definePattern, '\n')
  }

  const benchmarkStart = '// VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_START'
  const benchmarkEnd = '// VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_END'
  const startCount = result.split(benchmarkStart).length - 1
  const endCount = result.split(benchmarkEnd).length - 1
  if (startCount !== endCount) {
    throw new Error('Closed Agent user-presence benchmark markers are incomplete')
  }
  result = result.replace(
    /\/\/ VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_START[\s\S]*?\/\/ VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_END\n/gu,
    '',
  )
  if (/VAULTAGE_AGENT_PRESENCE|agentUserPresenceBenchmark|agentPresenceBenchmarkBuildPolicy/u.test(result)) {
    throw new Error('Unmarked closed Agent user-presence benchmark configuration remains in Community Vite config')
  }
  return result
}

export const openWebTypecheckInclude = [
  'src/renderer/**/*',
  'src/shared/**/*',
]

export const openWebTypecheckExclude = [
  'src/shared/ipcContractSurface.test.ts',
  // Community staging replaces the full declaration surface with env.open.d.ts.
  // Excluding the full file here keeps this source-tree check equivalent to
  // the staged build and prevents private provider/agent contracts leaking in.
  'src/renderer/src/env.d.ts',
  'src/renderer/src/main.tsx',
  'src/renderer/src/components/AddProviderModal.tsx',
  'src/renderer/src/components/AddSecretModal.tsx',
  'src/renderer/src/components/AgentView.tsx',
  'src/renderer/src/components/CreateCloudflareTokenModal.tsx',
  'src/renderer/src/components/ExtensionSaveCandidatePanel.tsx',
  'src/renderer/src/components/IntegrationSecretDetail.tsx',
  'src/renderer/src/components/IntegrationsView.tsx',
  'src/renderer/src/components/LegacyMainContent.tsx',
  'src/renderer/src/components/LegacyMainContent.test.ts',
  'src/renderer/src/components/legacyMainContentRoute.ts',
  'src/renderer/src/components/MainLayout.tsx',
  'src/renderer/src/components/ModeSwitcher.tsx',
  'src/renderer/src/components/ModeSwitcher.test.tsx',
  'src/renderer/src/components/OnboardingResearchPrompt.tsx',
  'src/renderer/src/components/ProviderIcons.tsx',
  'src/renderer/src/components/officialProviderBrandAssets.ts',
  'src/renderer/src/components/PinnedVaultLists.tsx',
  'src/renderer/src/components/PinnedVaultLists.test.tsx',
  'src/renderer/src/components/ProviderRoadmapPanel.tsx',
  'src/renderer/src/components/ProvidersModal.tsx',
  'src/renderer/src/components/ProjectsGuidanceHero.tsx',
  'src/renderer/src/components/ProjectsGuidanceHero.test.tsx',
  'src/renderer/src/components/ProjectsGuidancePlacement.test.mjs',
  'src/renderer/src/components/SecretDashboardModals.tsx',
  'src/renderer/src/components/SecretDetail.tsx',
  'src/renderer/src/components/SecretLifecycleModals.tsx',
  'src/renderer/src/components/SecretLocalDashboard.tsx',
  'src/renderer/src/components/SecretLocalDashboardModel.ts',
  'src/renderer/src/components/SecretLocalDashboardModel.test.ts',
  'src/renderer/src/components/SecretRequestPanel.tsx',
  'src/renderer/src/components/SecretRequestPanel.deposit.test.tsx',
  'src/renderer/src/components/SettingsModal.tsx',
  'src/renderer/src/components/Sidebar.tsx',
  'src/renderer/src/components/UsageMapView.tsx',
  'src/renderer/src/components/providerRoadmap.ts',
  'src/renderer/src/components/serviceCategoryIcons.tsx',
  'src/renderer/src/lib/providerCapabilities.ts',
  'src/renderer/src/lib/providerResearch.ts',
  'src/renderer/src/lib/providerResearch.test.ts',
  'src/renderer/src/lib/providerVotes.ts',
  'src/renderer/src/lib/serviceCategories.ts',
  'src/renderer/src/modeContext.tsx',
]

export const openElectronBuilderConfig = `appId: xyz.arcalab.vault-oc
productName: vault-OC

# Community has no updater runtime. The null value is intentional: electron-builder
# treats an empty list as permission to infer GitHub from .git/config, while
# null disables update-provider resolution and app-update.yml generation.
publish: null

directories:
  buildResources: build
  output: dist

asar: true
afterPack: scripts/apply-electron-fuses.cjs

files:
  - out/**/*
  - "!**/*.map"

mac:
  category: public.app-category.productivity
  minimumSystemVersion: "12.0"
  icon: resources/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist
  extendInfo:
    LSEnvironment:
      MallocNanoZone: "0"
  notarize: false
  extraResources:
    - from: resources/vault-keychain
      to: Vaultage Keychain
  target:
    - target: dmg
      arch: universal

dmg:
  sign: false
  title: vault-OC
`
