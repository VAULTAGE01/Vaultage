import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'

const checker = resolve(dirname(fileURLToPath(import.meta.url)), 'check-release-metadata.mjs')
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release metadata policy', () => {
  it('accepts a supported Electron and current policy snapshot', () => {
    const root = fixtureRoot()
    expect(check(root).status).toBe(0)
  })

  it('accepts the exact Linux-only Community workflow and release command', () => {
    const root = fixtureRoot({ community: true })
    expect(check(root).status).toBe(0)
  })

  it('rejects additional Community workflows', () => {
    const root = fixtureRoot({ community: true })
    write(root, '.github/workflows/release.yml', 'jobs: {}\n')

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Community packages must contain only .github/workflows/ci.yml')
  })

  it.each([
    ['private', {}, 'pnpm verify:release:portable', 'pnpm verify:release', 'private portable'],
    ['Community', { community: true }, 'pnpm verify:release', 'pnpm verify:release:portable', 'Community'],
  ])('requires the exact %s release command', (_label, options, expected, replacement, errorLabel) => {
    const root = fixtureRoot(options)
    const workflowPath = join(root, '.github/workflows/ci.yml')
    write(root, '.github/workflows/ci.yml', readFileSync(workflowPath, 'utf8').replace(expected, replacement))

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`missing the exact canonical ${errorLabel} release command step`)
  })

  it.each([
    ['job continue-on-error', '    runs-on: ubuntu-24.04', '    continue-on-error: true\n    runs-on: ubuntu-24.04'],
    ['job if false', '    runs-on: ubuntu-24.04', '    if: false\n    runs-on: ubuntu-24.04'],
    ['step continue-on-error', '        run: pnpm verify:release', '        continue-on-error: true\n        run: pnpm verify:release'],
    ['step if false', '        run: pnpm verify:release', '        if: false\n        run: pnpm verify:release'],
  ])('rejects a Community release gate with %s', (_label, current, replacement) => {
    const root = fixtureRoot({ community: true })
    const workflowPath = join(root, '.github/workflows/ci.yml')
    write(root, '.github/workflows/ci.yml', readFileSync(workflowPath, 'utf8').replace(current, replacement))

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be unconditional and blocking')
  })

  it('rejects arbitrary top-level writes and every job-level permission override', () => {
    const root = fixtureRoot({ community: true })
    const workflowPath = join(root, '.github/workflows/ci.yml')
    const workflow = readFileSync(workflowPath, 'utf8')
      .replace('  contents: read', '  contents: read\n  statuses: write')
      .replace('    runs-on: ubuntu-24.04', '    permissions:\n      contents: read\n    runs-on: ubuntu-24.04')
    write(root, '.github/workflows/ci.yml', workflow)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exactly read-only top-level contents permission')
    expect(result.stderr).toContain('must not override workflow permissions')
  })

  it('applies runner, timeout, matrix, and macOS-command prohibitions to Community CI', () => {
    const root = fixtureRoot({ community: true })
    const workflowPath = join(root, '.github/workflows/ci.yml')
    const workflow = readFileSync(workflowPath, 'utf8')
      .replace('runs-on: ubuntu-24.04', 'runs-on: macos-15')
      .replace('timeout-minutes: 15', 'timeout-minutes: 16\n    strategy:\n      matrix:\n        node: [22, 24]')
      .replace('        run: pnpm verify:release', '        run: pnpm verify:release\n      - run: pnpm verify:release:macos')
    write(root, '.github/workflows/ci.yml', workflow)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must run exactly on ubuntu-24.04')
    expect(result.stderr).toContain('must set timeout-minutes to an integer from 1 through 15')
    expect(result.stderr).toContain('must not use a matrix strategy')
    expect(result.stderr).toContain('Routine CI must remain Linux-only')
  })

  it('rejects stale support metadata and unsupported Electron majors', () => {
    const root = fixtureRoot({
      electron: '^39.8.10',
      policy: {
        checkedAt: '2020-01-01',
        supportedMajors: [41, 42, 43],
        latestStable: '43.1.0',
      },
    })

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('outside the checked supported majors')
    expect(result.stderr).toContain('Electron support policy is')
  })

  it('requires an exact release-tag/package-version match', () => {
    const root = fixtureRoot()
    const result = check(root, {
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v0.2.0',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not match package version v0.1.0')
  })

  it('rejects unsupported Windows packaging metadata', () => {
    const root = fixtureRoot({ scripts: { 'dist:win': 'electron-builder --win' } })
    write(root, 'electron-builder.yml', 'win:\n  target: nsis\n')
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('dist:win must stay absent')
    expect(result.stderr).toContain('unsupported Windows installer target')
  })

  it('rejects legacy ownership and any unapproved customer updater channel', () => {
    const root = fixtureRoot()
    write(root, 'electron-builder.yml', `appId: com.eden.vaultage
publish:
  provider: github
  owner: eden
  repo: vaultapp
mac:
  target: dmg
`)
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('official xyz.arcalab.vaultage application identifier')
    expect(result.stderr).toContain('must remain fail-closed')
    expect(result.stderr).toContain('must not retain the legacy app identity')
  })

  it('rejects production-only identity or updater overrides', () => {
    for (const override of [
      'appId: com.eden.vaultage\n',
      'publish:\n  provider: github\n  owner: attacker\n  repo: updates\n',
    ]) {
      const root = fixtureRoot()
      const production = readFileSync(join(root, 'electron-builder.production.yml'), 'utf8')
      write(root, 'electron-builder.production.yml', `${override}${production}`)
      const result = check(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('must not override the reviewed official app identity')
    }
  })

  it('rejects packaging the development native host', () => {
    const root = fixtureRoot()
    write(root, 'electron-builder.production.yml', `extends: electron-builder.yml
mac:
  extraResources:
    - from: browser-extension/native-host
      to: native-host
`)
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must not package the Node host')
  })

  it('rejects adding the extension host to ordinary packages', () => {
    const root = fixtureRoot()
    write(root, 'electron-builder.yml', 'mac:\n  extraResources:\n    - from: resources/vaultage-extension-native-host\n')
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ordinary Electron packages must remain extension-host-free')
  })

  it('rejects distributing a development extension candidate from a release', () => {
    const root = fixtureRoot()
    write(root, '.github/workflows/release.yml', `jobs:
  release:
    steps:
      - uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228
        with:
          files: artifacts/mac-dmg/browser-extension/candidate.zip
`)
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must validate but not distribute')
  })

  it('rejects broad release globs that could retain the development candidate', () => {
    const root = fixtureRoot()
    write(root, '.github/workflows/release.yml', `jobs:
  release:
    steps:
      - uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228
        with:
          files: dist/**
`)
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must validate but not distribute')
  })

  it('requires exact 14-day restricted Store candidate custody', () => {
    const root = fixtureRoot()
    installCanonicalReleaseWorkflow(root, workflow => workflow.replace('retention-days: 14', 'retention-days: 15'))
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exact restricted Store candidate evidence for 14 days')
  })

  it('rejects downloading the restricted Store candidate into the public release job', () => {
    const root = fixtureRoot()
    installCanonicalReleaseWorkflow(root, workflow => workflow.replace(
      'name: mac-dmg-acceptance\n          path: artifacts/mac-dmg-acceptance',
      'name: extension-store-candidate-restricted-${{ github.sha }}\n          path: artifacts/store-candidate',
    ))
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must download only the named mac-dmg and mac-dmg-acceptance artifacts')
  })

  it('rejects missing canonical agent policy and writable or credential-persisting CI', () => {
    const root = fixtureRoot()
    write(root, 'AGENTS.md', '# Agent instructions without the canonical pointer\n')
    write(root, '.github/workflows/ci.yml', `name: CI
permissions:
  contents: write
jobs:
  check:
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
`)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AGENTS.md must reference docs/ci-cd.md')
    expect(result.stderr).toContain('CI workflow must declare exactly read-only top-level contents permission')
    expect(result.stderr).toContain('disable persisted credentials')
  })

  it('rejects mutable or unapproved non-checkout actions in CI and release workflows', () => {
    const root = fixtureRoot()
    write(root, '.github/workflows/ci.yml', `name: CI
permissions:
  contents: read
jobs:
  check:
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v6
      - uses: unreviewed/example@${'a'.repeat(40)}
`)
    write(root, '.github/workflows/release.yml', `jobs:
  release:
    steps:
      - uses: softprops/action-gh-release@v3
`)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CI workflow must pin every external action to a full commit SHA')
    expect(result.stderr).toContain('CI workflow uses an action outside the reviewed allowlist: unreviewed/example')
    expect(result.stderr).toContain('Release workflow must pin every external action to a full commit SHA')
  })

  it('rejects moving routine CI back to a hosted macOS runner', () => {
    const root = fixtureRoot()
    const workflowPath = join(root, '.github/workflows/ci.yml')
    const workflow = readFileSync(workflowPath, 'utf8')
      .replace('runs-on: ubuntu-24.04', 'runs-on: macos-latest')
      .replace('cancel-in-progress: true', 'cancel-in-progress: false')
    write(root, '.github/workflows/ci.yml', workflow)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing the portable Linux release gate')
    expect(result.stderr).toContain('Routine CI must remain Linux-only')
    expect(result.stderr).toContain('missing the stale-run cancellation')
  })

  it.each([
    ['Windows', 'windows-2025'],
    ['self-hosted labels', '[self-hosted, Linux, X64]'],
    ['a larger runner', 'vaultage-16-core'],
    ['macOS as an array', '[macos-15]'],
  ])('rejects %s in any added routine CI job', (_label, runner) => {
    const root = fixtureRoot()
    const workflowPath = join(root, '.github/workflows/ci.yml')
    const workflow = `${readFileSync(workflowPath, 'utf8')}  unreviewed-job:\n    runs-on: ${runner}\n    timeout-minutes: 15\n    steps: []\n`
    write(root, '.github/workflows/ci.yml', workflow)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Routine CI job unreviewed-job must run exactly on ubuntu-24.04')
  })

  it('rejects matrix jobs even when their runner is Ubuntu', () => {
    const root = fixtureRoot()
    const workflowPath = join(root, '.github/workflows/ci.yml')
    const workflow = readFileSync(workflowPath, 'utf8').replace(
      '    runs-on: ubuntu-24.04\n',
      '    strategy:\n      matrix:\n        node: [22, 24]\n    runs-on: ubuntu-24.04\n',
    )
    write(root, '.github/workflows/ci.yml', workflow)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Routine CI job portable-release-gates must not use a matrix strategy')
  })

  it.each([
    ['a missing timeout', '    timeout-minutes: 15\n', ''],
    ['a zero timeout', '    timeout-minutes: 15', '    timeout-minutes: 0'],
    ['an excessive timeout', '    timeout-minutes: 15', '    timeout-minutes: 16'],
    ['a string timeout', '    timeout-minutes: 15', '    timeout-minutes: "15"'],
  ])('rejects %s in routine CI', (_label, current, replacement) => {
    const root = fixtureRoot()
    const workflowPath = join(root, '.github/workflows/ci.yml')
    const workflow = readFileSync(workflowPath, 'utf8').replace(current, replacement)
    write(root, '.github/workflows/ci.yml', workflow)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Routine CI job portable-release-gates must set timeout-minutes to an integer from 1 through 15',
    )
  })

  it('rejects flow-style uses mappings that could evade block-line validation', () => {
    const root = fixtureRoot()
    write(root, '.github/workflows/ci.yml', `name: CI
permissions:
  contents: read
jobs:
  check:
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false
      - { uses: unreviewed/example@${'a'.repeat(40)} }
`)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('canonical block-style uses line')
  })

  it.each([
    `      - "uses": unreviewed/example@${'a'.repeat(40)}\n`,
    `      - 'uses': unreviewed/example@${'a'.repeat(40)}\n`,
    `      - { "uses": unreviewed/example@${'a'.repeat(40)} }\n`,
    `      - { "u\\u0073es": unreviewed/example@${'a'.repeat(40)} }\n`,
  ])('rejects quoted or escaped uses keys that could evade text matching', hiddenStep => {
    const root = fixtureRoot()
    write(root, '.github/workflows/ci.yml', `name: CI
permissions:
  contents: read
jobs:
  check:
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false
${hiddenStep}`)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('canonical block-style uses line')
    expect(result.stderr).toContain('outside the reviewed allowlist')
  })

  it('rejects an approved action paired with an unreviewed commit', () => {
    const root = fixtureRoot()
    write(root, '.github/workflows/ci.yml', `name: CI
permissions:
  contents: read
jobs:
  check:
    steps:
      - uses: actions/checkout@${'a'.repeat(40)}
        with:
          persist-credentials: false
`)

    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('uses an unreviewed commit for actions/checkout')
  })
})

function fixtureRoot(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-release-metadata-'))
  roots.push(root)
  const pkg = {
    name: options.community ? 'vaultage-open-local' : 'vaultage-fixture',
    version: '0.1.0',
    packageManager: 'pnpm@11.11.0',
    engines: { node: '>=22.12.0' },
    scripts: options.scripts ?? (options.community ? {} : {
      'dist:mac:production': 'node scripts/build-full.mjs && bash scripts/build-extension-native-host.sh --production && electron-builder --config electron-builder.production.yml --mac --universal',
    }),
    devDependencies: { electron: options.electron ?? '^43.1.0' },
  }
  const policy = {
    checkedAt: new Date().toISOString().slice(0, 10),
    expiresAfterDays: 45,
    supportedMajors: [41, 42, 43],
    latestStable: '43.1.0',
    source: 'https://releases.electronjs.org/?channel=stable',
    policySource: 'https://www.electronjs.org/docs/latest/tutorial/electron-timelines',
    ...options.policy,
  }
  write(root, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  write(root, 'scripts/electron-support-policy.json', `${JSON.stringify(policy, null, 2)}\n`)
  write(
    root,
    'scripts/workflow-action-policy.json',
    `${JSON.stringify({
      runtime: 'node24',
      reviewedAt: new Date().toISOString().slice(0, 10),
      actions: {
        'actions/checkout': 'df4cb1c069e1874edd31b4311f1884172cec0e10',
        'pnpm/action-setup': '0ebf47130e4866e96fce0953f49152a61190b271',
        'actions/setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
        'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        'actions/download-artifact': '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
        'softprops/action-gh-release': '3d0d9888cb7fd7b750713d6e236d1fcb99157228',
      },
    }, null, 2)}\n`,
  )
  write(root, 'AGENTS.md', 'Follow docs/ci-cd.md.\n')
  write(root, 'CLAUDE.md', 'Follow docs/ci-cd.md.\n')
  write(root, 'electron-builder.yml', `appId: xyz.arcalab.vaultage
publish: []
mac:
  target: dmg
`)
  if (!options.community) write(root, 'electron-builder.production.yml', `extends: electron-builder.yml
mac:
  extraResources:
    - from: resources/vaultage-extension-native-host
      to: vaultage-extension-native-host
    - from: browser-extension/extension/provider-pages.json
      to: browser-extension/extension/provider-pages.json
  binaries:
    - Contents/Resources/vaultage-extension-native-host
`)
  write(root, '.github/workflows/ci.yml', `name: CI
permissions:
  contents: read
concurrency:
  cancel-in-progress: true
jobs:
  ${options.community ? 'community-release-gate' : 'portable-release-gates'}:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false
      - name: ${options.community ? 'Verify Community source' : 'Release gates'}
        run: ${options.community ? 'pnpm verify:release' : 'pnpm verify:release:portable'}
`)
  return root
}

function write(root, path, value) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value)
}

function installCanonicalReleaseWorkflow(root, transform) {
  const workflow = `jobs:
  build-mac:
    steps:
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
        with:
          name: extension-store-candidate-restricted-\${{ github.sha }}
          retention-days: 14
          if-no-files-found: error
          path: |
            dist/browser-extension/*-store.zip
            dist/browser-extension/*-store.zip.sha256
            dist/browser-extension/*-store.zip.provenance.json
            dist/browser-extension/store-release-receipt.json
  release:
    steps:
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c
        with:
          name: mac-dmg
          path: artifacts/mac-dmg
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c
        with:
          name: mac-dmg-acceptance
          path: artifacts/mac-dmg-acceptance
      - uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228
        with:
          files: artifacts/mac-dmg/*.dmg
`
  write(root, '.github/workflows/release.yml', transform(workflow))
}

function check(root, extraEnv = {}) {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
}
