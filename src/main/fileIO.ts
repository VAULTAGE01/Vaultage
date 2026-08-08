import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'

export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

export async function ensurePrivateDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE })
  await chmodIfPossible(path, PRIVATE_DIR_MODE)
}

export async function atomicWritePrivateFile(
  path: string,
  data: string | Buffer,
  options: { beforeCommit?: () => void | Promise<void> } = {},
): Promise<void> {
  const dir = dirname(path)
  const temp = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let handle: fs.FileHandle | null = null

  try {
    handle = await fs.open(temp, 'wx', PRIVATE_FILE_MODE)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null

    await options.beforeCommit?.()
    await fs.rename(temp, path)
    await chmodIfPossible(path, PRIVATE_FILE_MODE)
    await fsyncDirIfPossible(dir)
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => undefined)
    }
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw err
  }
}

export async function copyPrivateFile(source: string, target: string): Promise<void> {
  await fs.copyFile(source, target)
  await chmodIfPossible(target, PRIVATE_FILE_MODE)
}

async function chmodIfPossible(path: string, mode: number): Promise<void> {
  if (process.platform === 'win32') return
  await fs.chmod(path, mode).catch(() => undefined)
}

async function fsyncDirIfPossible(path: string): Promise<void> {
  if (process.platform === 'win32') return
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(path, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is best-effort across filesystems.
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}
