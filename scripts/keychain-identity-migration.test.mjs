import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('vault-keychain/main.swift', 'utf8')

describe('Keychain identity migration source contract', () => {
  it('defaults Community legacy enumeration to empty and requires an edition-matched marker', () => {
    expect(source).toContain('primaryService == COMMUNITY_PRIMARY_SERVICE ? [] : DEFAULT_LEGACY_SERVICES')
    expect(source).toContain('allowed: [expected]')
    expect(source).toContain('validatedLegacyServices(primaryService: PRIMARY_SERVICE)')
    expect(source).toContain('validatedMigrationService(primaryService: PRIMARY_SERVICE)')
  })

  it('stages recovery before deletion and retains it on every deletion or primary-write failure', () => {
    const transaction = source.slice(source.indexOf('func replaceStoredKey'), source.indexOf('func storeKey'))
    const stage = transaction.indexOf('stageMigrationKey(keyData)')
    const deleteOld = transaction.indexOf('deleteKeyAndRequireAbsent(service: service)')
    const writePrimary = transaction.indexOf('addKey(keyData, service: PRIMARY_SERVICE)')
    const deleteMarker = transaction.lastIndexOf('deleteKeyAndRequireAbsent(service: MIGRATION_SERVICE)')
    expect(stage).toBeGreaterThanOrEqual(0)
    expect(stage).toBeLessThan(deleteOld)
    expect(deleteOld).toBeLessThan(writePrimary)
    expect(writePrimary).toBeLessThan(deleteMarker)
    expect(transaction).toContain('guard deletionStatus == errSecSuccess')
    expect(transaction).toContain('guard primaryStatus == errSecSuccess')
  })

  it('treats a successful post-delete lookup as a deletion failure', () => {
    const deletion = source.slice(
      source.indexOf('func deleteKeyAndRequireAbsent'),
      source.indexOf('func addProtectedKey'),
    )
    expect(deletion).toContain('if existsStatus == errSecItemNotFound')
    expect(deletion).toContain('if existsStatus == errSecSuccess')
    expect(deletion).toContain('return errSecDuplicateItem')
    expect(deletion.indexOf('return errSecDuplicateItem')).toBeLessThan(deletion.lastIndexOf('return existsStatus'))
  })

  it('retries marker cleanup when a crash leaves both primary and recovery copies', () => {
    const retrieval = source.slice(source.indexOf('func retrieveKey'), source.indexOf('// ── remove'))
    expect(retrieval).toContain('keyExists(service: MIGRATION_SERVICE) == errSecSuccess')
    expect(retrieval).toContain('shouldRefreshProtectedItem = true')
    expect(retrieval).toContain('replaceStoredKey(data)')
  })
})
