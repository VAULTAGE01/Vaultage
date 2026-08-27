import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

const repositoryRoot = process.cwd()
const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    spawnSync('/bin/rm', ['-rf', root], { shell: false })
  }
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-native-export-check-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  cpSync(join(repositoryRoot, 'scripts', 'check-native-vnext-export.mjs'), join(root, 'scripts', 'check-native-vnext-export.mjs'))
  cpSync(join(repositoryRoot, 'native-export-manifest.json'), join(root, 'native-export-manifest.json'))
  cpSync(join(repositoryRoot, 'shared', 'VaultageCore'), join(root, 'shared', 'VaultageCore'), {
    recursive: true,
    filter: source => !source.endsWith('/.build') && !source.endsWith('/.swiftpm'),
  })
  return root
}

function check(root, args = [], environment = process.env) {
  return spawnSync(process.execPath, ['scripts/check-native-vnext-export.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    shell: false,
  })
}

describe('native vNext export boundary', () => {
  it('accepts the exact committed manifest and file bytes', () => {
    const result = check(fixture())
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('25 manifest-bound files')
  })

  it('rejects files outside the explicit manifest', () => {
    const root = fixture()
    writeFileSync(join(root, 'shared', 'VaultageCore', 'Sources', 'VaultageCore', 'Unexpected.swift'), 'struct Unexpected {}\n')
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exported file is outside the manifest')
  })

  it('rejects digest drift and forbidden commercial content', () => {
    const root = fixture()
    const path = join(root, 'shared', 'VaultageCore', 'Sources', 'VaultageCore', 'TOTPGenerator.swift')
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n// WorkOS implementation must stay private.\n`)
    const result = check(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('digest mismatch')
    expect(result.stderr).toContain('forbidden WorkOS implementation')
  })

  it('fails strict provenance when no authorized private source is supplied', () => {
    const root = fixture()
    const environment = { ...process.env }
    delete environment.VAULTAGE_NATIVE_SOURCE_ROOT
    const result = check(root, ['--require-source'], environment)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('VAULTAGE_NATIVE_SOURCE_ROOT is required')
  })
})
