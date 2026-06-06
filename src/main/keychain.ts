import { app } from 'electron'
import { join } from 'path'
import { spawnSync } from 'child_process'

export const IS_MAC = process.platform === 'darwin'

export interface KeychainResult {
  key: string | null
  cancelled: boolean
  notFound: boolean
  authFailed: boolean
}

export function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'Vaultage Community Keychain')
    : join(app.getAppPath(), 'resources', 'vault-keychain')
}

export function keychainStore(hexKey: string): boolean {
  if (!IS_MAC) return false
  const result = spawnSync(helperPath(), ['store', hexKey], {
    encoding: 'utf8',
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
  const result = spawnSync(helperPath(), ['remove'], {
    encoding: 'utf8',
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

export function keychainRetrieve(prompt = 'unlock Vaultage Community'): KeychainResult {
  if (!IS_MAC) {
    return { key: null, cancelled: false, authFailed: false, notFound: true }
  }

  const result = spawnSync(helperPath(), ['retrieve', prompt], {
    encoding: 'utf8',
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

  return {
    key: result.status === 0 ? (result.stdout as string).trim() : null,
    cancelled: result.status === 2,
    authFailed: result.status === 3,
    notFound: result.status === 4,
  }
}
