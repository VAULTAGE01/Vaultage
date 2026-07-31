export const MAX_KEYCHAIN_HELPER_BYTES = 4 * 1024 * 1024

export type KeychainHelperMetadata = {
  isFile: boolean
  isSymbolicLink: boolean
  mode: number
  uid: number
  size: number
}

export type KeychainServiceCoordinates = {
  service: string
  legacyServices: string
  migrationService: string
}

const SESSION_ENVIRONMENT_KEYS = ['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME'] as const

export function keychainServiceCoordinates(): KeychainServiceCoordinates {
  return {
    service: 'xyz.arcalab.vault-oc.masterkey',
    legacyServices: '',
    migrationService: 'xyz.arcalab.vault-oc.masterkey.migration',
  }
}

export function buildKeychainHelperEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  coordinates: KeychainServiceCoordinates,
  developmentRoot?: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    VAULTAGE_KEYCHAIN_SERVICE: coordinates.service,
    VAULTAGE_KEYCHAIN_LEGACY_SERVICES: coordinates.legacyServices,
    VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: coordinates.migrationService,
  }
  for (const name of SESSION_ENVIRONMENT_KEYS) {
    const value = source[name]
    if (value) environment[name] = value
  }
  if (developmentRoot) environment.VAULTAGE_KEYCHAIN_DEV_ROOT = developmentRoot
  return environment
}

/**
 * Applies the filesystem half of the native-helper trust policy. The Swift
 * helper independently authenticates its parent process from macOS audit/code
 * signing state; these checks make path substitution and unsafe packaging fail
 * before Electron launches anything.
 */
export function keychainHelperMetadataError(
  metadata: KeychainHelperMetadata,
  currentUid: number | undefined,
): string | null {
  if (metadata.isSymbolicLink) return 'helper must not be a symbolic link'
  if (!metadata.isFile) return 'helper is not a regular file'
  if (metadata.size <= 0 || metadata.size > MAX_KEYCHAIN_HELPER_BYTES) {
    return 'helper size is outside the allowed range'
  }
  if ((metadata.mode & 0o111) === 0) return 'helper is not executable'
  if ((metadata.mode & 0o022) !== 0) return 'helper is group- or world-writable'
  if (currentUid !== undefined && metadata.uid !== currentUid && metadata.uid !== 0) {
    return 'helper owner is neither the current user nor root'
  }
  return null
}
