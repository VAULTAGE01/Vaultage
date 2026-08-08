import { app } from 'electron'
import { existsSync, lstatSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import {
  buildKeychainHelperEnvironment,
  keychainServiceCoordinates,
  keychainHelperMetadataError,
} from './keychainPolicy'

export const IS_MAC = process.platform === 'darwin'

export interface KeychainResult {
  key: string | null
  cancelled: boolean
  notFound: boolean
  authFailed: boolean
}

export function helperPath(): string {
  if (!app.isPackaged) return join(app.getAppPath(), 'resources', 'vault-keychain')
  const packagedPath = join(process.resourcesPath, 'Vaultage Keychain')
  return existsSync(packagedPath)
    ? packagedPath
    : join(process.resourcesPath, 'vault-keychain')
}

export function keychainHelperEnvironment(): NodeJS.ProcessEnv {
  const coordinates = keychainServiceCoordinates()
  return buildKeychainHelperEnvironment(
    process.env,
    coordinates,
    app.isPackaged ? undefined : app.getAppPath(),
  )
}

export function trustedHelperPath(): string | null {
  const candidate = helperPath()
  try {
    const stat = lstatSync(candidate)
    const metadataError = keychainHelperMetadataError(
      {
        isFile: stat.isFile(),
        isSymbolicLink: stat.isSymbolicLink(),
        mode: stat.mode,
        uid: stat.uid,
        size: stat.size,
      },
      process.getuid?.(),
    )
    if (metadataError) {
      console.error(`[keychain] rejected native helper: ${metadataError}`)
      return null
    }

    const signature = spawnSync(
      '/usr/bin/codesign',
      ['--verify', '--strict', '--all-architectures', '--', candidate],
      {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        timeout: 5_000,
      },
    )
    if (signature.status !== 0) {
      console.error('[keychain] rejected native helper: code signature verification failed', {
        status: signature.status,
        signal: signature.signal,
        error: signature.error?.message,
        stderr: signature.stderr?.toString().trim().slice(0, 500),
      })
      return null
    }
    return candidate
  } catch (err) {
    console.error('[keychain] rejected native helper', { error: String(err) })
    return null
  }
}

export function keychainStore(hexKey: string): boolean {
  if (!IS_MAC) return false
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) return false
  const executable = trustedHelperPath()
  if (!executable) return false
  const result = spawnSync(executable, ['store'], {
    encoding: 'utf8',
    input: hexKey,
    env: keychainHelperEnvironment(),
    timeout: 5_000,
  })
  if (result.status !== 0) {
    console.error('[keychain] store failed', {
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stderr: result.stderr?.toString().trim(),
    })
  }
  return result.status === 0
}

export function keychainRemove(): boolean {
  if (!IS_MAC) return false
  const executable = trustedHelperPath()
  if (!executable) return false
  const result = spawnSync(executable, ['remove'], {
    encoding: 'utf8',
    env: keychainHelperEnvironment(),
    timeout: 5_000,
  })
  if (result.status !== 0) {
    console.error('[keychain] remove failed', {
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stderr: result.stderr?.toString().trim(),
    })
  }
  return result.status === 0
}

export function keychainRetrieve(
  prompt?: string,
  policy: 'standard' | 'biometric-only' = 'standard',
): KeychainResult {
  if (!IS_MAC) {
    return { key: null, cancelled: false, authFailed: false, notFound: true }
  }

  const executable = trustedHelperPath()
  if (!executable) {
    return { key: null, cancelled: false, authFailed: true, notFound: false }
  }
  const result = spawnSync(executable, [policy === 'biometric-only' ? 'retrieve-biometric' : 'retrieve'], {
    encoding: 'utf8',
    input: normalizeKeychainPrompt(prompt),
    env: keychainHelperEnvironment(),
    timeout: 30_000,
  })

  if (![0, 2, 3, 4].includes(result.status ?? -1)) {
    console.error('[keychain] retrieve failed', {
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stderr: result.stderr?.toString().trim(),
    })
  }

  const helperFailed = ![0, 2, 3, 4].includes(result.status ?? -1)
  const key = result.status === 0 ? (result.stdout as string).trim() : null
  const validKey = key && /^[0-9a-f]{64}$/i.test(key) ? key : null
  if (result.status === 0 && !validKey) console.error('[keychain] helper returned invalid key material')
  return {
    key: validKey,
    cancelled: result.status === 2,
    authFailed: result.status === 3 || helperFailed,
    notFound: result.status === 4,
  }
}

export function normalizeKeychainPrompt(prompt: string | undefined): string {
  const normalized = (prompt ?? 'Unlock Vaultage')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 512)
  return normalized || 'Unlock Vaultage'
}
