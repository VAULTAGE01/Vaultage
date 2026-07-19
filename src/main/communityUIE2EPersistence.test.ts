import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertEncryptedCommunityProfile } from './communityUIE2EAssertions'
import type { CommunityUIE2ERun } from './communityUIE2ERun'

const SENSITIVE_VALUES = ['fixture-password', 'fixture-secret-value', '123456'] as const
const DISPLAY_NAMES = ['Fixture Secret', 'Fixture Project'] as const
const FIELD_IDENTIFIER = 'FIXTURE_FIELD'
const PLAINTEXT_POLICY = {
  alwaysForbidden: [...SENSITIVE_VALUES, ...DISPLAY_NAMES],
  auditFieldIdentifiers: [FIELD_IDENTIFIER],
} as const
const roots: string[] = []

type PersistenceFixture = {
  readonly auditFile: string
  readonly encryptedFile: string
  readonly recordsDir: string
  readonly run: CommunityUIE2ERun
}

function createFixture(): PersistenceFixture {
  const root = mkdtempSync(join(tmpdir(), 'community-ui-e2e-persistence-'))
  roots.push(root)
  const profileDir = join(root, 'profile')
  const vaultDir = join(profileDir, 'vault-data')
  const recordsDir = join(vaultDir, 'records')
  mkdirSync(recordsDir, { recursive: true, mode: 0o700 })
  const auditFile = join(vaultDir, 'audit.log')
  const encryptedFile = join(vaultDir, 'vault.aaaaaaaa.enc')
  writeFileSync(auditFile, FIELD_IDENTIFIER, { mode: 0o600 })
  writeFileSync(encryptedFile, 'ciphertext', { mode: 0o600 })
  writeFileSync(join(recordsDir, 'record.enc'), 'ciphertext', { mode: 0o600 })
  return {
    auditFile,
    encryptedFile,
    recordsDir,
    run: {
      alternateProjectDir: join(root, 'alternate-project'),
      appRoot: join(root, 'app'),
      homeDir: join(root, 'home'),
      manualScanFile: join(root, 'project', 'manual.config'),
      ownedParent: root,
      profileDir,
      projectDir: join(root, 'project'),
      root: join(root, 'vaultage-policy-fixture'),
      tmpDir: join(root, 'tmp'),
    },
  }
}

function inspect(fixture: PersistenceFixture) {
  return assertEncryptedCommunityProfile(fixture.run, PLAINTEXT_POLICY)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const recordsDir = join(root, 'profile', 'vault-data', 'records')
    const encryptedFile = join(root, 'profile', 'vault-data', 'vault.aaaaaaaa.enc')
    if (existsSync(recordsDir)) chmodSync(recordsDir, 0o700)
    if (existsSync(encryptedFile)) chmodSync(encryptedFile, 0o600)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Community UI E2E persistence assertions', () => {
  it.each([
    { label: '0750', mode: 0o750 },
    { label: '0500', mode: 0o500 },
  ] as const)('rejects a $label vault directory', ({ mode }) => {
    // Given
    const fixture = createFixture()
    chmodSync(fixture.recordsDir, mode)

    // When / Then
    expect(() => inspect(fixture)).toThrow()
  })

  it.each([
    { label: '0640', mode: 0o640 },
    { label: '0400', mode: 0o400 },
  ] as const)('rejects a $label vault file', ({ mode }) => {
    // Given
    const fixture = createFixture()
    chmodSync(fixture.encryptedFile, mode)

    // When / Then
    expect(() => inspect(fixture)).toThrow()
  })

  it.each(DISPLAY_NAMES)('rejects display metadata in the authenticated audit log', value => {
    // Given
    const fixture = createFixture()
    writeFileSync(fixture.auditFile, value)

    // When / Then
    expect(() => inspect(fixture)).toThrow()
  })

  it.each(SENSITIVE_VALUES)('rejects sensitive plaintext in the authenticated audit log', value => {
    // Given
    const fixture = createFixture()
    writeFileSync(fixture.auditFile, value)

    // When / Then
    expect(() => inspect(fixture)).toThrow()
  })

  it('allows the field identifier only in the authenticated audit log', () => {
    // Given
    const fixture = createFixture()

    // When / Then
    expect(() => inspect(fixture)).not.toThrow()
  })

  it('rejects the field identifier in encrypted storage', () => {
    // Given
    const fixture = createFixture()
    writeFileSync(fixture.encryptedFile, FIELD_IDENTIFIER)

    // When / Then
    expect(() => inspect(fixture)).toThrow()
  })

  it('rejects forbidden plaintext in a profile file outside vault storage', () => {
    // Given
    const fixture = createFixture()
    writeFileSync(join(fixture.run.profileDir, 'Cache.bin'), DISPLAY_NAMES[0], { mode: 0o600 })

    // When / Then
    expect(() => inspect(fixture)).toThrow()
  })

  it('returns exact mode counts for a valid profile', () => {
    // Given
    const fixture = createFixture()

    // When
    const receipt = inspect(fixture)

    // Then
    expect(receipt).toEqual({
      directoryModes: { '0700': 2 },
      encryptedFiles: 1,
      fileModes: { '0600': 3 },
      profileFilesScanned: 3,
    })
  })
})
