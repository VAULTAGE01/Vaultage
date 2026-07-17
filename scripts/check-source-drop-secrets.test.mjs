import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scanner = resolve(dirname(fileURLToPath(import.meta.url)), 'check-source-drop-secrets.mjs')
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('source-drop secret scanner fixture policy', () => {
  it('detects a credential-shaped value without printing it', () => {
    const root = fixtureRoot()
    const value = `sk-${'A'.repeat(40)}`
    write(root, 'src/example.ts', `export const value = '${value}'\n`)

    const result = scan(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('OpenAI secret key')
    expect(result.stderr).toContain(createHash('sha256').update(value).digest('hex'))
    expect(result.stderr).not.toContain(value)
  })

  it('allows only an exact test-path, pattern, and fingerprint match', () => {
    const root = fixtureRoot()
    const value = `sk-${'B'.repeat(40)}`
    const path = 'src/example.test.ts'
    write(root, path, `export const value = '${value}'\n`)
    writeAllowlist(root, [{
      path,
      pattern: 'OpenAI secret key',
      sha256: createHash('sha256').update(value).digest('hex'),
      reason: 'Synthetic scanner fixture with no production credential value.',
    }])

    expect(scan(root).status).toBe(0)

    write(root, path, `export const value = 'sk-${'C'.repeat(40)}'\n`)
    const changed = scan(root)
    expect(changed.status).toBe(1)
    expect(changed.stderr).toContain('stale secret fixture allowlist entry')
    expect(changed.stderr).toContain('OpenAI secret key')
  })

  it('rejects allowlist entries outside test source files', () => {
    const root = fixtureRoot()
    const value = `sk-${'D'.repeat(40)}`
    write(root, 'src/example.ts', `export const value = '${value}'\n`)
    writeAllowlist(root, [{
      path: 'src/example.ts',
      pattern: 'OpenAI secret key',
      sha256: createHash('sha256').update(value).digest('hex'),
      reason: 'This invalid entry proves production sources cannot be allowlisted.',
    }])

    const result = scan(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('allowlist path must be a test source file')
  })
})

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-secret-scan-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeAllowlist(root, [])
  return root
}

function write(root, path, value) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value)
}

function writeAllowlist(root, entries) {
  write(root, 'scripts/source-secret-scan-allowlist.json', `${JSON.stringify(entries, null, 2)}\n`)
}

function scan(root) {
  return spawnSync(process.execPath, [scanner], { cwd: root, encoding: 'utf8' })
}
