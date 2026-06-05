import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { open, seal } from './vaultCrypto'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'

export const VAULT_DIR = join(app.getPath('userData'), 'vault-data')
export const VAULT_FILE = join(VAULT_DIR, 'vault.enc')
export const WRAPPED_KEY_FILE = join(VAULT_DIR, 'key.wrapped')
export const PARAMS_FILE = join(VAULT_DIR, 'params.json')
export const AUDIT_LOG_FILE = join(VAULT_DIR, 'audit.log')

let vaultWriteQueue = Promise.resolve()

export async function ensureVaultDir(): Promise<void> {
  await ensurePrivateDir(VAULT_DIR)
}

export async function readVault(key: Buffer): Promise<unknown> {
  return readVaultFile(key)
}

async function readVaultFile(key: Buffer): Promise<unknown> {
  const blob = await fs.readFile(VAULT_FILE)
  return JSON.parse(open(blob, key).toString('utf8'))
}

export async function writeVault(json: string, key: Buffer): Promise<void> {
  await enqueueVaultWrite(() => atomicWritePrivateFile(VAULT_FILE, seal(Buffer.from(json, 'utf8'), key)))
}

export async function updateVault<T>(
  key: Buffer,
  updater: (vault: unknown) => { json: string; result: T } | Promise<{ json: string; result: T }>,
): Promise<T> {
  return enqueueVaultWrite(async () => {
    const current = await readVaultFile(key)
    const { json, result } = await updater(current)
    await atomicWritePrivateFile(VAULT_FILE, seal(Buffer.from(json, 'utf8'), key))
    return result
  })
}

export async function writeParams(raw: string): Promise<void> {
  await atomicWritePrivateFile(PARAMS_FILE, raw)
}

export async function writeWrappedKey(raw: Buffer): Promise<void> {
  await atomicWritePrivateFile(WRAPPED_KEY_FILE, raw)
}

function enqueueVaultWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = vaultWriteQueue.catch(() => undefined).then(operation)
  vaultWriteQueue = run.then(() => undefined, () => undefined)
  return run
}
