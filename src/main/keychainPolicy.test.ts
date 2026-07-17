import { describe, expect, it } from 'vitest'
import {
  MAX_KEYCHAIN_HELPER_BYTES,
  buildKeychainHelperEnvironment,
  keychainHelperMetadataError,
  type KeychainHelperMetadata,
} from './keychainPolicy'

const secureMetadata: KeychainHelperMetadata = {
  isFile: true,
  isSymbolicLink: false,
  mode: 0o100755,
  uid: 501,
  size: 128_000,
}

describe('native Keychain helper filesystem policy', () => {
  it('accepts a bounded executable owned by the current user', () => {
    expect(keychainHelperMetadataError(secureMetadata, 501)).toBeNull()
  })

  it('accepts a root-owned packaged helper', () => {
    expect(keychainHelperMetadataError({ ...secureMetadata, uid: 0 }, 501)).toBeNull()
  })

  it.each([
    [{ isSymbolicLink: true }, 'symbolic link'],
    [{ isFile: false }, 'regular file'],
    [{ mode: 0o100644 }, 'not executable'],
    [{ mode: 0o100775 }, 'group- or world-writable'],
    [{ uid: 502 }, 'neither the current user nor root'],
    [{ size: 0 }, 'outside the allowed range'],
    [{ size: MAX_KEYCHAIN_HELPER_BYTES + 1 }, 'outside the allowed range'],
  ] as const)('rejects unsafe metadata %j', (overrides, message) => {
    expect(keychainHelperMetadataError({ ...secureMetadata, ...overrides }, 501)).toContain(message)
  })
})

describe('native Keychain helper environment policy', () => {
  it('forwards only fixed service coordinates and ordinary session variables', () => {
    const environment = buildKeychainHelperEnvironment(
      {
        HOME: '/Users/test',
        TMPDIR: '/tmp/session',
        LANG: 'en_US.UTF-8',
        DYLD_INSERT_LIBRARIES: '/tmp/attack.dylib',
        LD_PRELOAD: '/tmp/attack.dylib',
        VAULTAGE_KEYCHAIN_SERVICE: 'attacker.service',
      },
      {
        service: 'xyz.arcalab.vaultage.masterkey',
        legacyServices: 'com.eden.vaultage.masterkey,com.eden.vaultage.masterkey.migration,dev.vault.app.masterkey',
        migrationService: 'xyz.arcalab.vaultage.masterkey.migration',
      },
      '/workspace/VaultApp',
    )

    expect(environment).toEqual({
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: '/Users/test',
      TMPDIR: '/tmp/session',
      LANG: 'en_US.UTF-8',
      VAULTAGE_KEYCHAIN_SERVICE: 'xyz.arcalab.vaultage.masterkey',
      VAULTAGE_KEYCHAIN_LEGACY_SERVICES: 'com.eden.vaultage.masterkey,com.eden.vaultage.masterkey.migration,dev.vault.app.masterkey',
      VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: 'xyz.arcalab.vaultage.masterkey.migration',
      VAULTAGE_KEYCHAIN_DEV_ROOT: '/workspace/VaultApp',
    })
  })
})
