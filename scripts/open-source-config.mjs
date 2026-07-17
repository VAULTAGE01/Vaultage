// New files in closed feature families are private by default. Only explicit
// `.disabled.*` compile seams survive Community staging.
const privateOverlaySourcePatterns = [
  /^browser-extension\//,
  /^bin\/vaultage\.mjs$/,
  /^docs\/roadmap(?:\/|$)/,
  /^schemas\/agent-[^/]+\.schema\.json$/,
  /^scripts\/linear-roadmap(?:\/|$)/,
  /^src\/cli\//,
  /^src\/main\/(?:agent|commercial|extension|provider)[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/shared\/(?:agent|commercial|extension|provider)[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/renderer\/.*\/(?:Agent|Commercial|Extension|Integration|Provider|Service|UsageMap)[^/]*\.[cm]?[jt]sx?$/,
  /^src\/renderer\/.*\/(?:agent|commercial|extension|integration|provider|service)[^/]*\.[cm]?[jt]sx?$/i,
  /^src\/renderer\/src\/components\/SettingsModal\.tsx$/,
]

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
  'src/main/providerBasicOps.disabled.ts',
  'src/main/providerLifecycleOps.disabled.ts',
  'src/main/providerVote.disabled.ts',
  'src/main/providerWorkerClient.disabled.ts',
  'src/renderer/src/commercialAccountContext.disabled.tsx',
  'src/renderer/src/components/AddProviderModal.disabled.tsx',
  'src/renderer/src/components/CommercialAccountSettings.disabled.tsx',
  'src/renderer/src/components/CommercialProjectActivation.disabled.tsx',
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

export const openNodeAliasPaths = {
  '#agent-composition': ['src/main/agentComposition.disabled.ts'],
  '#extension-handoff': ['src/main/extensionHandoff.disabled.ts'],
  '#extension-candidate-vault': ['src/main/extensionCandidateVault.disabled.ts'],
  '#extension-native-host-composition': ['src/main/extensionNativeHostComposition.disabled.ts'],
  '#extension-native-host-ipc': ['src/main/extensionNativeHostIpc.disabled.ts'],
  '#provider-ipc': ['src/main/providerIpc.disabled.ts'],
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
  '#commercial-project-activation': ['src/renderer/src/components/CommercialProjectActivation.disabled.tsx'],
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
  if (markerMatches.every(match => !match)) {
    if (/VAULTAGE_COMMERCIAL_RELEASE|__VAULTAGE_COMMERCIAL_RUNTIME_CONFIGURATION__|commercialRuntimeConfig/u.test(source)) {
      throw new Error('Unmarked closed release configuration remains in Community Vite config')
    }
    return source
  }
  if (!markerMatches.every(Boolean)) {
    throw new Error('Closed release configuration markers are incomplete')
  }
  let result = source
  for (const pattern of patterns) {
    result = result.replace(pattern, '')
  }
  return result.replace(definePattern, '\n')
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
  'src/renderer/src/components/AddProviderModal.tsx',
  'src/renderer/src/components/AddSecretModal.tsx',
  'src/renderer/src/components/AgentView.tsx',
  'src/renderer/src/components/CreateCloudflareTokenModal.tsx',
  'src/renderer/src/components/ExtensionSaveCandidatePanel.tsx',
  'src/renderer/src/components/IntegrationSecretDetail.tsx',
  'src/renderer/src/components/IntegrationsView.tsx',
  'src/renderer/src/components/MainLayout.tsx',
  'src/renderer/src/components/ModeSwitcher.tsx',
  'src/renderer/src/components/ProviderIcons.tsx',
  'src/renderer/src/components/ProviderRoadmapPanel.tsx',
  'src/renderer/src/components/ProvidersModal.tsx',
  'src/renderer/src/components/SecretDashboardModals.tsx',
  'src/renderer/src/components/SecretDetail.tsx',
  'src/renderer/src/components/SecretLifecycleModals.tsx',
  'src/renderer/src/components/SecretLocalDashboard.tsx',
  'src/renderer/src/components/SecretLocalDashboardModel.ts',
  'src/renderer/src/components/SecretLocalDashboardModel.test.ts',
  'src/renderer/src/components/SecretRequestPanel.tsx',
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
