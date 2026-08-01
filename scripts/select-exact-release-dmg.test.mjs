import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const checker = resolve(dirname(fileURLToPath(import.meta.url)), 'select-exact-release-dmg.mjs')
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('exact Community release DMG selection', () => {
  it.each([0, 2])('rejects a release directory containing %i DMGs', count => {
    const root = fixture(count)
    const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`exactly one regular DMG; found ${count}`)
  })

  it('selects one DMG and binds its exact build-stage name', () => {
    const root = fixture(1)
    const record = join(root, 'record.json')
    writeFileSync(record, JSON.stringify({
      schemaVersion: 1,
      kind: 'vaultage-packaged-mac-artifact-record-v1',
      appSha256: 'a'.repeat(64),
      dmgSha256: 'b'.repeat(64),
      dmgName: 'vault-OC-0.1.2.dmg',
    }))
    const accepted = spawnSync(
      process.execPath,
      [checker, root, '--artifact-record', record],
      { encoding: 'utf8' },
    )
    expect(accepted.status, accepted.stderr).toBe(0)
    expect(accepted.stdout.trim()).toBe(join(root, 'vault-OC-0.1.2.dmg'))
    writeFileSync(record, JSON.stringify({
      schemaVersion: 1,
      kind: 'vaultage-packaged-mac-artifact-record-v1',
      appSha256: 'a'.repeat(64),
      dmgSha256: 'b'.repeat(64),
      dmgName: 'Other.dmg',
    }))
    expect(spawnSync(process.execPath, [checker, root, '--artifact-record', record]).status).toBe(1)
  })

  it('binds the selected bytes and name to the downloaded acceptance receipt', () => {
    const root = fixture(1)
    const receipt = join(root, 'acceptance.json')
    const bytes = Buffer.from('dmg-0')
    writeFileSync(receipt, JSON.stringify({
      schemaVersion: 1,
      kind: 'vaultage-downloaded-mac-artifact-acceptance-v1',
      dmgName: 'vault-OC-0.1.2.dmg',
      dmgSha256: createHash('sha256').update(bytes).digest('hex'),
    }))
    expect(
      spawnSync(process.execPath, [checker, root, '--acceptance-receipt', receipt]).status,
    ).toBe(0)
    writeFileSync(join(root, 'vault-OC-0.1.2.dmg'), 'changed')
    expect(
      spawnSync(process.execPath, [checker, root, '--acceptance-receipt', receipt]).status,
    ).toBe(1)
  })
})

function fixture(count) {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-release-dmg-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(root, index ? 'Other.dmg' : 'vault-OC-0.1.2.dmg'), `dmg-${index}`)
  }
  return root
}
