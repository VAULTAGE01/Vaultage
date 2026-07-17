import { constants, promises as fs } from 'fs'
import { join } from 'path'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'
import type { PersistedPinAttemptState, QuickRevealPinThrottleStore } from './quickRevealPin'

const MAX_STATE_BYTES = 4 * 1024

export class QuickRevealPinThrottleFileStore implements QuickRevealPinThrottleStore {
  constructor(private readonly directory: string) {}

  async load(key: string): Promise<PersistedPinAttemptState | null> {
    let handle: fs.FileHandle | null = null
    try {
      const path = this.path(key)
      handle = await fs.open(path, constants.O_RDONLY | noFollowFlag())
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_STATE_BYTES) {
        throw new Error('Invalid reveal PIN throttle state file')
      }
      const parsed = JSON.parse(await handle.readFile('utf8')) as Record<string, unknown>
      if (
        typeof parsed.failures !== 'number' || !Number.isInteger(parsed.failures) || parsed.failures < 0 ||
        typeof parsed.blockedUntil !== 'number' || !Number.isFinite(parsed.blockedUntil) || parsed.blockedUntil < 0 ||
        typeof parsed.lastTouched !== 'number' || !Number.isFinite(parsed.lastTouched) || parsed.lastTouched < 0
      ) throw new Error('Invalid reveal PIN throttle state')
      return {
        failures: Math.min(10, parsed.failures),
        blockedUntil: parsed.blockedUntil,
        lastTouched: parsed.lastTouched,
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async save(key: string, state: PersistedPinAttemptState): Promise<void> {
    await ensurePrivateDir(this.directory)
    await atomicWritePrivateFile(this.path(key), `${JSON.stringify(state)}\n`)
  }

  async clear(key: string): Promise<void> {
    await fs.rm(this.path(key), { force: true })
  }

  async clearAll(): Promise<void> {
    await fs.rm(this.directory, { recursive: true, force: true })
  }

  private path(key: string): string {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid PIN throttle key')
    return join(this.directory, `${key}.json`)
  }
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}
