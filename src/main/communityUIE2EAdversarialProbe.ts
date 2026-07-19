import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'

const ATOMIC_WRITE_ARTIFACT = /^\..+\.[1-9][0-9]*\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/u
const AUDIT_JOURNAL_ARTIFACT = /^audit\.log(?:\.anchor(?:-required)?|\.segment-[0-9a-f]{64}\.jsonl)?$/u

export type CommunityUIE2EApiResult = {
  readonly error: string | null
  readonly revision: number | null
  readonly success: boolean
}

export async function invokeCommunityUIE2EApi(
  page: Page,
  methodName: string,
  payload?: unknown,
): Promise<unknown> {
  return await page.evaluate(async input => {
    const api: unknown = Reflect.get(window, 'vault')
    if (typeof api !== 'object' || api === null) throw new TypeError('Community preload API is unavailable')
    const method: unknown = Reflect.get(api, input.methodName)
    if (typeof method !== 'function') throw new TypeError('Community preload method is unavailable')
    return input.payload === undefined
      ? await Reflect.apply(method, api, [])
      : await Reflect.apply(method, api, [input.payload])
  }, { methodName, payload })
}

export function parseCommunityUIE2EApiResult(value: unknown): CommunityUIE2EApiResult {
  if (typeof value !== 'object' || value === null) throw new TypeError('Community IPC result is unavailable')
  const success = Reflect.get(value, 'success')
  if (typeof success !== 'boolean') throw new TypeError('Community IPC result has no success flag')
  const error = Reflect.get(value, 'error')
  if (error !== undefined && typeof error !== 'string') throw new TypeError('Community IPC error is invalid')
  const data = Reflect.get(value, 'data')
  const revision = typeof data === 'object' && data !== null ? Reflect.get(data, 'revision') : null
  return {
    error: typeof error === 'string' ? error : null,
    revision: typeof revision === 'number' ? revision : null,
    success,
  }
}

export async function installCommunityUIE2EDialog(
  application: ElectronApplication,
  canceled: boolean,
  filePaths: readonly string[],
): Promise<void> {
  await application.evaluate(({ dialog }, response) => {
    dialog.showOpenDialog = async () => ({ canceled: response.canceled, filePaths: response.filePaths })
  }, { canceled, filePaths: [...filePaths] })
}

export function vaultDataDigest(profileDir: string): string {
  const root = join(profileDir, 'vault-data')
  const hash = createHash('sha256')
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ATOMIC_WRITE_ARTIFACT.test(entry.name)
        || (directory === root && AUDIT_JOURNAL_ARTIFACT.test(entry.name))) continue
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new TypeError('Community vault data contains an unsupported entry')
      }
      hash.update(`${relative(root, path)}\0${stat.mode & 0o777}\0`)
      if (entry.isDirectory()) visit(path)
      else hash.update(readFileSync(path))
    }
  }
  visit(root)
  return hash.digest('hex')
}
