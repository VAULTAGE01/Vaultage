import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPrivateAgentCompositionLeaks,
  findPrivatePreloadModuleImportLeaks,
  findPrivatePreloadIpcChannelLeaks,
  isPrivateOverlaySourcePath,
  isReviewedDisabledSeamPath,
  reviewedDisabledSeamPaths,
  openNodeAliasPaths,
  openWebAliasPaths,
  stripClosedReleaseConfiguration,
} from './open-source-config.mjs'

function sourceFilesBelow(root, directory = root, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) sourceFilesBelow(root, path, files)
    else if (entry.isFile()) files.push(path.slice(root.length + 1).replaceAll('\\', '/'))
  }
  return files
}

function writeFixture(root, path, source) {
  const absolutePath = join(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, source)
}

describe('Community source boundary configuration', () => {
  it('allows only explicitly reviewed disabled seams', () => {
    expect(isReviewedDisabledSeamPath('src/main/commercialRuntime.disabled.ts')).toBe(true)
    expect(isPrivateOverlaySourcePath('src/main/commercialRuntime.disabled.ts')).toBe(false)

    const disguisedPrivateImplementation = 'src/main/commercialCredentialBroker.disabled.ts'
    expect(isReviewedDisabledSeamPath(disguisedPrivateImplementation)).toBe(false)
    expect(isPrivateOverlaySourcePath(disguisedPrivateImplementation)).toBe(true)
    expect(reviewedDisabledSeamPaths.has(disguisedPrivateImplementation)).toBe(false)
    expect(isPrivateOverlaySourcePath('src/renderer/src/commercialAccountContext.tsx'))
      .toBe(true)
    expect(isPrivateOverlaySourcePath('src/renderer/src/CommercialAccountSettings.tsx'))
      .toBe(true)
  })

  it('keeps the Linear roadmap source and mutation tooling private by path family', () => {
    for (const path of [
      'docs/roadmap/LINEAR-BACKLOG-2026-07-16.md',
      'docs/roadmap/future/private-plan.md',
      'scripts/linear-roadmap/parser.mjs',
      'scripts/linear-roadmap/future/reconcile.mjs',
      'scripts\\linear-roadmap\\windows-path.mjs',
    ]) {
      expect(isPrivateOverlaySourcePath(path), path).toBe(true)
    }

    expect(isPrivateOverlaySourcePath('docs/roadmapping.md')).toBe(false)
    expect(isPrivateOverlaySourcePath('scripts/linear-roadmap-public.mjs')).toBe(false)
  })

  it('keeps the native Agent user-presence QA runner private', () => {
    expect(isPrivateOverlaySourcePath('scripts/run-agent-user-presence-benchmark.sh')).toBe(true)
    expect(isPrivateOverlaySourcePath('scripts/run-agent-user-presence-benchmark.test.mjs')).toBe(true)
    expect(isPrivateOverlaySourcePath('src/main/nativeUserPresence.ts')).toBe(true)
    expect(isPrivateOverlaySourcePath('src/main/nativeUserPresence.test.ts')).toBe(true)
    expect(isPrivateOverlaySourcePath('scripts/check-browser-extension-pairing.mjs')).toBe(true)
    expect(isPrivateOverlaySourcePath('scripts/services-ui-e2e.mjs')).toBe(true)
    expect(isPrivateOverlaySourcePath('scripts/services-provider-flow-visual-qa.mjs')).toBe(true)
  })

  it('allows only the reviewed Community-safe UI2026 foundation', () => {
    for (const path of [
      'src/renderer/src/ui2026/surfaces/ServicesSurface.tsx',
      'src/renderer/src/ui2026/Ui2026Showcase.tsx',
      'src/renderer/src/ui2026/surfaces/VaultSurface.tsx',
      'src/renderer/src/ui2026/surfaces/servicesWorkspace.ts',
      'src/renderer/src/ui2026/assets/services-destinations/all-services-hero.png',
      'src/renderer/src/ui2026/ui2026Structure.test.ts',
    ]) {
      expect(isPrivateOverlaySourcePath(path), path).toBe(true)
    }

    for (const path of [
      'src/renderer/src/ui2026/assets/projects-hero.png',
      'src/renderer/src/ui2026/assets/index.ts',
      'src/renderer/src/ui2026/flags.test.ts',
      'src/renderer/src/ui2026/flags.ts',
      'src/renderer/src/ui2026/focusRestoration.test.ts',
      'src/renderer/src/ui2026/focusRestoration.ts',
      'src/renderer/src/ui2026/primitives.test.tsx',
      'src/renderer/src/ui2026/primitives.tsx',
      'src/renderer/src/ui2026/primitives/cards.tsx',
      'src/renderer/src/ui2026/primitives/hero.tsx',
      'src/renderer/src/ui2026/primitives/rail.tsx',
      'src/renderer/src/ui2026/primitives/rows.tsx',
      'src/renderer/src/ui2026/primitives/shell.tsx',
      'src/renderer/src/ui2026/primitives/types.ts',
      'src/renderer/src/ui2026/referenceComposition.tsx',
      'src/renderer/src/ui2026/surfaces/VaultDashboard.open.tsx',
      'src/renderer/src/ui2026/surfaces/VaultReferenceRail.open.tsx',
      'src/renderer/src/ui2026/surfaces/VaultSearchPanel.open.tsx',
      'src/renderer/src/ui2026/surfaces/VaultSurface.open.css',
      'src/renderer/src/ui2026/surfaces/VaultSurface.open.test.tsx',
      'src/renderer/src/ui2026/surfaces/VaultSurface.open.tsx',
      'src/renderer/src/ui2026/surfaces/vaultSurfaceActions.open.ts',
      'src/renderer/src/ui2026/surfaces/vaultSurfaceActions.open.test.ts',
      'src/renderer/src/ui2026/surfaces/vaultSurfaceModel.open.test.ts',
      'src/renderer/src/ui2026/surfaces/vaultSurfaceModel.open.ts',
      'src/renderer/src/ui2026/surfaces/ProjectsSurface.test.tsx',
      'src/renderer/src/ui2026/surfaces/ProjectsSurface.tsx',
      'src/renderer/src/ui2026/surfaces/projectsModel.test.ts',
      'src/renderer/src/ui2026/surfaces/projectsModel.ts',
      'src/renderer/src/ui2026/surfaces/projectsSurface.css',
      'src/renderer/src/ui2026/surfaceNavigation.test.tsx',
      'src/renderer/src/ui2026/surfaceNavigation.tsx',
      'src/renderer/src/ui2026/surfaceSearch.ts',
      'src/renderer/src/ui2026/ui2026.css',
    ]) {
      expect(isPrivateOverlaySourcePath(path), path).toBe(false)
    }
  })

  it('keeps nested private provider implementations out of Community source', () => {
    for (const path of [
      'src/main/cloudflare/cloudflareApi.ts',
      'src/main/providers/awsSecretsManager.ts',
      'src/main/providers/firebase/secretManager.ts',
      'src/main/providers/railwayVariablesAdapter.ts',
      'src/shared/awsProjectEnvironment.ts',
      'src/shared/awsProjectEnvironment.test.ts',
      'src/renderer/src/components/AwsProjectEnvironmentDetail.tsx',
      'src/renderer/src/components/AwsProjectEnvironmentDetail.test.tsx',
    ]) {
      expect(isPrivateOverlaySourcePath(path), path).toBe(true)
    }
  })

  it('keeps paid-beta onboarding implementation private by path family', () => {
    for (const path of [
      'src/renderer/src/components/PaidBetaOnboarding.tsx',
      'src/renderer/src/components/PaidBetaOnboardingOptions.tsx',
      'src/renderer/src/lib/paidBetaOnboarding.ts',
      'src/renderer/src/lib/paidBetaOnboarding.test.ts',
    ]) {
      expect(isPrivateOverlaySourcePath(path), path).toBe(true)
    }
  })

  it('keeps browser-extension pairing implementation families private by default', () => {
    for (const path of [
      'src/main/browserExtensionIdentity.ts',
      'src/main/browserExtensionIdentityNext.ts',
      'src/main/browserExtensionNativeHostRegistrar.ts',
      'src/main/browserExtensionNativeHostFuture.ts',
      'src/main/browserExtensionPairingController.ts',
      'src/main/browserExtensionPairing/futureStore.ts',
      'src/shared/browserExtensionContracts.ts',
      'src/shared/browserExtensionContractsV2.ts',
      'src/shared/browserExtensionContracts/future.ts',
      'src/shared/extensionPairingIpcContracts.ts',
      'src/shared/extensionPairingIpcContractsV2.ts',
      'src/shared/extensionPairingIpcContracts/future.ts',
      'src/preload/browserExtensionBridge.ts',
      'src/preload/browserExtensionBridgeNext.ts',
      'src/preload/browserExtensionBridge/future.ts',
      'src/preload/extensionPairingBridge.ts',
      'src/preload/extensionPairingBridgeNext.ts',
      'src/preload/extensionPairingBridge/future.ts',
      'src/renderer/src/hooks/useExtensionPairing.ts',
      'src/renderer/src/hooks/useExtensionPairingState.ts',
      'src/renderer/src/hooks/useExtensionPairing/future.ts',
    ]) {
      expect(isPrivateOverlaySourcePath(path), path).toBe(true)
    }

    expect(isPrivateOverlaySourcePath('src/main/auditEventTypes.ts')).toBe(false)
    expect(isPrivateOverlaySourcePath('src/main/auditEventTypes.open.ts')).toBe(false)
    expect(isPrivateOverlaySourcePath('src/main/browserExtensionStatus.ts')).toBe(false)
    expect(isPrivateOverlaySourcePath('src/shared/browserExtensionTypes.ts')).toBe(false)
    expect(isPrivateOverlaySourcePath('src/preload/browserExtensionTypes.ts')).toBe(false)
  })

  it('requires every disabled source seam in the repository to be reviewed', () => {
    const root = resolve(import.meta.dirname, '..')
    const disabledSources = sourceFilesBelow(root, join(root, 'src'))
      .filter(path => /\.disabled\.[cm]?[jt]sx?$/.test(path))
      .sort()
    // A staged Community tree intentionally omits a small number of reviewed
    // shims that its simplified renderer no longer imports, so require the
    // security-critical direction: every disabled file that exists is reviewed.
    expect(disabledSources.filter(path => !reviewedDisabledSeamPaths.has(path)))
      .toEqual([])
  })

  it('keeps every declared Community alias target present and reviewed', () => {
    const root = resolve(import.meta.dirname, '..')
    const sourceFiles = sourceFilesBelow(root, join(root, 'src'))
    for (const paths of [...Object.values(openNodeAliasPaths), ...Object.values(openWebAliasPaths)]) {
      for (const path of paths) {
        expect(sourceFiles.includes(path), path).toBe(true)
        if (/\.disabled\.[cm]?[jt]sx?$/.test(path)) {
          expect(reviewedDisabledSeamPaths.has(path), path).toBe(true)
        }
      }
    }
  }, 15_000)

  it('rejects every current and future commercial IPC channel or event', () => {
    const hardcodedChannels = [
      'commercial:auth:sign-in',
      'commercial:device:register',
      'commercial:billing:portal',
      'commercial:export:request',
      'commercial:account:delete',
      'commercial:status-changed',
    ]
    for (const channel of hardcodedChannels) {
      expect(findPrivatePreloadIpcChannelLeaks(
        `ipcRenderer.invoke('${channel}', payload)`,
      )).toContain('commercial:')
    }
    expect(findPrivatePreloadIpcChannelLeaks("ipcRenderer.invoke('vault:backup')"))
      .toEqual([])
    for (const channel of [
      'vault:respond-extension-pairing',
      'vault:get-extension-pairing-status',
      'vault:unpair-extension-pairing',
      'vault:extension-pairing-request',
      'vault:extension-pairing-expired',
    ]) {
      expect(findPrivatePreloadIpcChannelLeaks(
        `ipcRenderer.invoke('${channel}', payload)`,
      )).toContain(channel)
    }
  })

  it('rejects direct pairing bridge or contract imports from the public preload entrypoint', () => {
    for (const source of [
      "import { browserExtensionAgentApi } from './browserExtensionBridge'",
      "import { browserExtensionIpcContracts } from '../shared/browserExtensionContracts'",
      "import '../shared/browserExtensionContracts'",
      "await import('../shared/browserExtensionContracts')",
      "import { extensionPairingApi } from './extensionPairingBridge'",
      "import { extensionPairingIpcContracts } from '../shared/extensionPairingIpcContracts'",
    ]) {
      expect(findPrivatePreloadModuleImportLeaks(source)).not.toEqual([])
    }
    expect(findPrivatePreloadModuleImportLeaks(
      "import { vaultIpcContracts } from '../shared/vaultIpcContracts'",
    )).toEqual([])
  })

  it('rejects private Agent credential and standing-grant composition terms', () => {
    expect(findPrivateAgentCompositionLeaks(
      'const match = tryAutoApproval({ requestedKeys, environmentScope, grantId })',
    )).toEqual(['tryAutoApproval', 'requestedKeys', 'environmentScope', 'grantId'])
    expect(findPrivateAgentCompositionLeaks('registerAgentComposition({ server })')).toEqual([])
    expect(findPrivateAgentCompositionLeaks(readFileSync(
      resolve(import.meta.dirname, '..', 'src/main/agentComposition.disabled.ts'),
      'utf8',
    ))).toEqual([])
  })

  it('strips complete release-loader markers and rejects partial or unmarked private loaders', () => {
    const marked = [
      'public-before',
      '// VAULTAGE_CLOSED_RELEASE_CONFIGURATION_START',
      "import './commercialRuntimeConfig'",
      '// VAULTAGE_CLOSED_RELEASE_CONFIGURATION_END',
      '// VAULTAGE_CLOSED_RELEASE_PROFILE_START',
      'const paid = process.env.VAULTAGE_COMMERCIAL_RELEASE_MODE',
      '// VAULTAGE_CLOSED_RELEASE_PROFILE_END',
      'define: {',
      '  // VAULTAGE_CLOSED_RELEASE_DEFINE_START',
      '  __VAULTAGE_COMMERCIAL_RUNTIME_CONFIGURATION__: paid,',
      '  // VAULTAGE_CLOSED_RELEASE_DEFINE_END',
      '}',
    ].join('\n') + '\n'
    const stripped = stripClosedReleaseConfiguration(marked)
    expect(stripped).toContain('public-before')
    expect(stripped).not.toMatch(/COMMERCIAL_RELEASE|commercialRuntimeConfig/u)
    expect(stripClosedReleaseConfiguration(stripped)).toBe(stripped)
    expect(() => stripClosedReleaseConfiguration(
      marked.replace('// VAULTAGE_CLOSED_RELEASE_PROFILE_END\n', ''),
    )).toThrow(/incomplete/i)
    expect(() => stripClosedReleaseConfiguration(
      'const mode = process.env.VAULTAGE_COMMERCIAL_RELEASE_MODE\n',
    )).toThrow(/Unmarked/i)

    const benchmarkMarked = [
      marked,
      '// VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_START',
      "const qaEntry = 'agentUserPresenceBenchmark'",
      '// VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_END',
      '',
    ].join('\n')
    expect(stripClosedReleaseConfiguration(benchmarkMarked)).not.toContain('agentUserPresenceBenchmark')
    expect(() => stripClosedReleaseConfiguration(
      `${benchmarkMarked}// VAULTAGE_CLOSED_AGENT_PRESENCE_BENCHMARK_START\n`,
    )).toThrow(/benchmark markers are incomplete/i)
  })

  it('makes the compiled Community artifact gate fail on a hardcoded commercial channel', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'vaultage-open-artifact-boundary-'))
    try {
      writeFixture(fixture, 'out/main/index.js', '/* Community main */')
      writeFixture(
        fixture,
        'out/preload/index.js',
        "ipcRenderer.invoke('commercial:account:delete')",
      )
      writeFixture(fixture, 'out/preload/menuPanel.js', '/* menu panel */')
      writeFixture(
        fixture,
        'out/renderer/assets/index.js',
        [
          'darkGrey',
          'opacity-28',
          'mix-blend-screen',
          'rgba(210,220,214,0.052)',
          'rgba(210,220,214,0.055)',
        ].join(' '),
      )
      const result = spawnSync(
        process.execPath,
        [resolve(import.meta.dirname, 'check-open-artifact.mjs')],
        { cwd: fixture, encoding: 'utf8' },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('forbidden private IPC channel: commercial:')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('makes the compiled Community artifact gate fail on private Agent composition', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'vaultage-open-agent-boundary-'))
    try {
      writeFixture(fixture, 'out/main/index.js', 'function tryAutoApproval(requestedKeys) {}')
      writeFixture(fixture, 'out/preload/index.js', '/* Community preload */')
      writeFixture(fixture, 'out/preload/menuPanel.js', '/* menu panel */')
      writeFixture(
        fixture,
        'out/renderer/assets/index.js',
        ['darkGrey', 'opacity-28', 'mix-blend-screen', 'rgba(210,220,214,0.052)', 'rgba(210,220,214,0.055)'].join(' '),
      )
      const result = spawnSync(
        process.execPath,
        [resolve(import.meta.dirname, 'check-open-artifact.mjs')],
        { cwd: fixture, encoding: 'utf8' },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('forbidden private Agent composition term: tryAutoApproval')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
