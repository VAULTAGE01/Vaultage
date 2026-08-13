import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  promises as fs,
  renameSync,
  unlinkSync,
} from 'fs'
import { execFile as execFileCallback } from 'child_process'
import { randomUUID } from 'crypto'
import { basename, dirname, join, resolve } from 'path'
import { promisify } from 'util'
import {
  type EnvValueEntry,
  serializeEnvFile,
  validateEnvEntries,
  validateProjectPath,
} from './security'

const MAX_GITIGNORE_BYTES = 1024 * 1024
const GIT_QUERY_TIMEOUT_MS = 2_000
const MAX_GIT_QUERY_OUTPUT_BYTES = 1_024
const execFile = promisify(execFileCallback)

export type EnvFileAction = 'created' | 'replaced' | 'not-written'
export type GitignoreAction = 'created' | 'updated' | 'unchanged' | 'not-requested' | 'not-updated'

export interface ProjectEnvFileWriteStatus {
  envFile: EnvFileAction
  gitignore: GitignoreAction
}

export interface WriteProjectEnvFileOptions {
  projectPath: unknown
  entries: unknown
  addToGitignore?: unknown
  /** Existing .env files are never replaced unless this is exactly true. */
  overwriteExisting?: unknown
  invalidPathMessage?: string
  signal?: AbortSignal
  /** Rechecked immediately before each atomic commit. */
  authorizeCommit?: () => boolean | Promise<boolean>
}

export interface WriteProjectEnvFileResult {
  targetFolder: string
  safeEntries: EnvValueEntry[]
  status: ProjectEnvFileWriteStatus
}

export class ProjectEnvFileWriteError extends Error {
  constructor(message: string, readonly partial: ProjectEnvFileWriteStatus, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProjectEnvFileWriteError'
  }
}

export function projectEnvFilePartialResult(error: unknown): ProjectEnvFileWriteStatus | undefined {
  return error instanceof ProjectEnvFileWriteError ? error.partial : undefined
}

export async function writeProjectEnvFile(
  options: WriteProjectEnvFileOptions,
): Promise<WriteProjectEnvFileResult> {
  const targetFolderInput = validateProjectPath(options.projectPath)
  if (!targetFolderInput) throw new Error(options.invalidPathMessage ?? 'Invalid project path')

  const targetFolder = await canonicalRegularDirectory(targetFolderInput, options.invalidPathMessage)
  const safeEntries = validateEnvEntries(options.entries)
  const status: ProjectEnvFileWriteStatus = {
    envFile: 'not-written',
    gitignore: options.addToGitignore === true ? 'not-updated' : 'not-requested',
  }

  try {
    await assertAuthorized(options)
    await assertDotenvIsNotGitTracked(targetFolder)
    const envPath = join(targetFolder, '.env')
    const envExisted = await regularFileExistsNoFollow(envPath)
    if (envExisted && options.overwriteExisting !== true) {
      throw new Error('A .env file already exists; explicitly approve replacing it')
    }
    if (options.addToGitignore === true) {
      status.gitignore = await ensureDotenvIgnored(targetFolder, options)
    }
    await atomicWritePrivateFile(
      envPath,
      serializeEnvFile(safeEntries),
      envExisted,
      options,
    )
    status.envFile = envExisted ? 'replaced' : 'created'

    return { targetFolder, safeEntries, status }
  } catch (error) {
    if (error instanceof ProjectEnvFileWriteError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ProjectEnvFileWriteError(message, { ...status }, { cause: error })
  }
}

/** `.gitignore` cannot protect a path that Git already tracks. */
async function assertDotenvIsNotGitTracked(targetFolder: string): Promise<void> {
  const repositoryStatus = await gitExitCode(targetFolder, ['rev-parse', '--is-inside-work-tree'])
  if (repositoryStatus === 128) return
  if (repositoryStatus !== 0) {
    throw new Error('Could not verify whether .env is Git-tracked; use vaultage run instead')
  }

  const trackedStatus = await gitExitCode(targetFolder, ['ls-files', '--error-unmatch', '--', '.env'])
  if (trackedStatus === 1) return
  if (trackedStatus === 0) {
    throw new Error('Refusing to write a Git-tracked .env; untrack it or use vaultage run instead')
  }
  throw new Error('Could not verify whether .env is Git-tracked; use vaultage run instead')
}

async function gitExitCode(targetFolder: string, args: readonly string[]): Promise<number> {
  try {
    await execFile('git', ['-C', targetFolder, ...args], {
      timeout: GIT_QUERY_TIMEOUT_MS,
      maxBuffer: MAX_GIT_QUERY_OUTPUT_BYTES,
      windowsHide: true,
    })
    return 0
  } catch (error) {
    const exitCode = processExitCode(error)
    if (exitCode !== null) return exitCode
    throw new Error('Could not verify whether .env is Git-tracked; use vaultage run instead', { cause: error })
  }
}

function processExitCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const code = Reflect.get(error, 'code')
  return typeof code === 'number' && Number.isInteger(code) ? code : null
}

async function ensureDotenvIgnored(
  targetFolder: string,
  options: Pick<WriteProjectEnvFileOptions, 'signal' | 'authorizeCommit'>,
): Promise<GitignoreAction> {
  const gitignorePath = join(targetFolder, '.gitignore')
  const existing = await readRegularFileNoFollow(gitignorePath)
  if (existing !== null && existing.split(/\r?\n/).some(line => line.trim() === '.env')) {
    return 'unchanged'
  }

  const separator = existing && !existing.endsWith('\n') ? '\n' : ''
  const next = `${existing ?? ''}${separator}.env\n`
  await atomicWritePrivateFile(gitignorePath, next, existing !== null, options)
  return existing === null ? 'created' : 'updated'
}

async function canonicalRegularDirectory(input: string, invalidPathMessage?: string): Promise<string> {
  const normalized = resolve(input)
  const stat = await fs.lstat(normalized).catch(() => null)
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(invalidPathMessage ?? 'Invalid project path')
  }
  const canonical = await fs.realpath(normalized)
  return canonical
}

async function regularFileExistsNoFollow(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`${basename(path)} must not be a symbolic link`)
    if (!stat.isFile()) throw new Error(`${basename(path)} must be a regular file`)
    return true
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false
    throw error
  }
}

async function readRegularFileNoFollow(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    const initialStat = await fs.lstat(path)
    if (initialStat.isSymbolicLink()) throw new Error(`${basename(path)} must not be a symbolic link`)
    if (!initialStat.isFile()) throw new Error(`${basename(path)} must be a regular file`)
    handle = await fs.open(path, constants.O_RDONLY | noFollowFlag())
    const pathStat = await fs.lstat(path)
    if (pathStat.isSymbolicLink()) throw new Error(`${basename(path)} must not be a symbolic link`)
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`${basename(path)} must be a regular file`)
    if (stat.size > MAX_GITIGNORE_BYTES) throw new Error('.gitignore is too large to update safely')
    return await handle.readFile('utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null
    if (isNodeError(error, 'ELOOP')) throw new Error(`${basename(path)} must not be a symbolic link`)
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function atomicWritePrivateFile(
  targetPath: string,
  content: string,
  overwrite: boolean,
  options: Pick<WriteProjectEnvFileOptions, 'signal' | 'authorizeCommit'>,
): Promise<void> {
  const folder = dirname(targetPath)
  const tempPath = join(folder, `.${basename(targetPath)}.vaultage-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  let tempExists = false

  try {
    handle = await fs.open(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
      0o600,
    )
    tempExists = true
    await handle.writeFile(content, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = null

    await assertAuthorized(options)
    if (overwrite) {
      assertReplaceableTarget(targetPath)
      renameSync(tempPath, targetPath)
      tempExists = false
    } else {
      linkSync(tempPath, targetPath)
      try {
        unlinkSync(tempPath)
        tempExists = false
      } catch {
        // The destination is already durably linked. The finally block makes a
        // second best-effort cleanup attempt for the staging name.
      }
    }
    syncDirectory(folder)
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      throw new Error(`${basename(targetPath)} appeared while it was being written; retry after reviewing it`)
    }
    if (isNodeError(error, 'ELOOP')) throw new Error(`${basename(targetPath)} must not be a symbolic link`)
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
    if (tempExists) await fs.unlink(tempPath).catch(() => undefined)
  }
}

function assertReplaceableTarget(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`${basename(path)} must not be a symbolic link`)
    if (!stat.isFile()) throw new Error(`${basename(path)} must be a regular file`)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return
    throw error
  }
}

async function assertAuthorized(
  options: Pick<WriteProjectEnvFileOptions, 'signal' | 'authorizeCommit'>,
): Promise<void> {
  if (options.signal?.aborted) throw new Error('Project env write was cancelled before commit')
  if (options.authorizeCommit && !(await options.authorizeCommit())) {
    throw new Error('Vaultage locked before the project env write could commit')
  }
}

function syncDirectory(path: string): void {
  let fd: number | null = null
  try {
    fd = openSync(path, constants.O_RDONLY)
    fsyncSync(fd)
  } catch {
    // Some platforms do not support fsync on directory handles. File content
    // itself was fsynced before the atomic commit.
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
