import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPrivateAgentCompositionLeaks,
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
    for (const paths of [...Object.values(openNodeAliasPaths), ...Object.values(openWebAliasPaths)]) {
      for (const path of paths) {
        expect(sourceFilesBelow(root).includes(path), path).toBe(true)
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
