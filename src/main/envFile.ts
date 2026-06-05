import { promises as fs } from 'fs'
import { join } from 'path'
import {
  type EnvValueEntry,
  serializeEnvFile,
  validateEnvEntries,
  validateProjectPath,
} from './security'

export interface WriteProjectEnvFileOptions {
  projectPath: unknown
  entries: unknown
  addToGitignore?: unknown
  invalidPathMessage?: string
}

export interface WriteProjectEnvFileResult {
  targetFolder: string
  safeEntries: EnvValueEntry[]
}

export async function writeProjectEnvFile(
  options: WriteProjectEnvFileOptions,
): Promise<WriteProjectEnvFileResult> {
  const targetFolder = validateProjectPath(options.projectPath)
  if (!targetFolder) throw new Error(options.invalidPathMessage ?? 'Invalid project path')

  const safeEntries = validateEnvEntries(options.entries)
  await fs.writeFile(join(targetFolder, '.env'), serializeEnvFile(safeEntries), 'utf8')

  if (options.addToGitignore) {
    await ensureDotenvIgnored(targetFolder)
  }

  return { targetFolder, safeEntries }
}

async function ensureDotenvIgnored(targetFolder: string): Promise<void> {
  const gitignorePath = join(targetFolder, '.gitignore')
  try {
    const existing = await fs.readFile(gitignorePath, 'utf8')
    if (!existing.split('\n').some(line => line.trim() === '.env')) {
      await fs.appendFile(gitignorePath, '\n.env\n')
    }
  } catch {
    await fs.writeFile(gitignorePath, '.env\n')
  }
}
