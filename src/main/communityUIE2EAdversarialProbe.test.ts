import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { vaultDataDigest } from './communityUIE2EAdversarialProbe'

const temporaryProfiles: string[] = []

afterEach(() => {
  for (const profile of temporaryProfiles.splice(0)) {
    rmSync(profile, { recursive: true, force: true })
  }
})

describe('Community UI E2E vault digest', () => {
  it('ignores uncommitted atomic-write artifacts', () => {
    const profile = mkdtempSync(join(tmpdir(), 'vaultage-community-digest-'))
    temporaryProfiles.push(profile)
    const vaultData = join(profile, 'vault-data')
    mkdirSync(vaultData)
    writeFileSync(join(vaultData, '.audit.log.anchor'), 'committed')
    const committedDigest = vaultDataDigest(profile)

    writeFileSync(
      join(vaultData, '.audit.log.anchor.3452.8008de40-5992-41b6-a618-f97d7649f27e.tmp'),
      'uncommitted',
    )

    expect(vaultDataDigest(profile)).toBe(committedDigest)
  })

  it('includes canonical vault state but excludes audit journal churn', () => {
    const profile = mkdtempSync(join(tmpdir(), 'vaultage-community-digest-'))
    temporaryProfiles.push(profile)
    const vaultData = join(profile, 'vault-data')
    mkdirSync(vaultData)
    const vaultFile = join(vaultData, 'vault.enc')
    const auditFiles = [
      'audit.log',
      'audit.log.anchor',
      'audit.log.anchor-required',
      `audit.log.segment-${'a'.repeat(64)}.jsonl`,
    ].map(name => join(vaultData, name))
    writeFileSync(vaultFile, 'canonical-v1')
    for (const auditFile of auditFiles) writeFileSync(auditFile, 'audit-v1')
    const committedDigest = vaultDataDigest(profile)

    for (const auditFile of auditFiles) writeFileSync(auditFile, 'audit-v2')
    expect(vaultDataDigest(profile)).toBe(committedDigest)

    writeFileSync(vaultFile, 'canonical-v2')
    expect(vaultDataDigest(profile)).not.toBe(committedDigest)
  })
})
