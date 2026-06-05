import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  atomicWritePrivateFile,
  copyPrivateFile,
  ensurePrivateDir,
} from './fileIO'

let tempRoot: string | null = null

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('private file IO helpers', () => {
  it('creates private directories and atomically writes private files', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-file-io-'))
    const dir = join(tempRoot, 'vault-data')
    const file = join(dir, 'vault.enc')

    await ensurePrivateDir(dir)
    await atomicWritePrivateFile(file, 'secret payload')

    expect(await readFile(file, 'utf8')).toBe('secret payload')
    if (process.platform !== 'win32') {
      expect((await stat(dir)).mode & 0o777).toBe(PRIVATE_DIR_MODE)
      expect((await stat(file)).mode & 0o777).toBe(PRIVATE_FILE_MODE)
    }
  })

  it('copies files with private file permissions', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-file-io-'))
    const source = join(tempRoot, 'source')
    const target = join(tempRoot, 'target')
    await writeFile(source, 'wrapped key')

    await copyPrivateFile(source, target)

    expect(await readFile(target, 'utf8')).toBe('wrapped key')
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(PRIVATE_FILE_MODE)
    }
  })
})
