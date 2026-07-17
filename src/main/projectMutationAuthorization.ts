import type { VaultMutationCommand } from '../shared/vaultIpcContracts'
import {
  CREATE_PROJECT_GRANT_TARGET,
  existingProjectGrantTarget,
  type ProjectFolderGrantTarget,
} from './projectCapabilities'

type RecordLike = Record<string, unknown>

export interface ProjectFolderAuthorizer {
  requireProjectFolder(
    webContentsId: number,
    candidatePath: string,
    target: ProjectFolderGrantTarget,
    consume?: boolean,
  ): Promise<string>
}

/**
 * Binds every newly persisted local Project path to a native-picker grant.
 * Existing unchanged paths remain usable across restarts, but an untrusted
 * renderer cannot first persist an arbitrary destination and then export
 * plaintext secrets to it.
 */
export async function authorizeProjectPathMutation(
  rawVault: unknown,
  command: VaultMutationCommand,
  webContentsId: number,
  folders: ProjectFolderAuthorizer,
): Promise<VaultMutationCommand> {
  if (command.type !== 'env-project.create'
    && command.type !== 'env-project.update'
    && command.type !== 'env-project.update-many') return command

  const vault = record(rawVault, 'vault')
  const currentProjects = records(vault.envProjects, 'environment projects')
  if (command.type === 'env-project.update-many') {
    const projects = records(command.projects, 'environment projects')
    return {
      ...command,
      projects: await Promise.all(projects.map(project => authorizeProject(
        project,
        currentProjects.find(candidate => candidate.id === project.id),
        webContentsId,
        folders,
        existingProjectGrantTarget(typeof project.id === 'string' ? project.id : ''),
      ))),
    }
  }

  const project = record(command.project, 'environment project')
  return {
    ...command,
    project: await authorizeProject(
      project,
    currentProjects.find(candidate => candidate.id === project.id),
    webContentsId,
    folders,
    command.type === 'env-project.create'
      ? CREATE_PROJECT_GRANT_TARGET
      : existingProjectGrantTarget(typeof project.id === 'string' ? project.id : ''),
    ),
  }
}

async function authorizeProject(
  project: RecordLike,
  currentProject: RecordLike | undefined,
  webContentsId: number,
  folders: ProjectFolderAuthorizer,
  target: ProjectFolderGrantTarget,
): Promise<RecordLike> {
  const currentPaths = new Set(localProjectPaths(currentProject))
  const authorizedPaths = new Set<string>()
  const path = await authorizeChangedPath(project.path, currentPaths, webContentsId, folders, target, authorizedPaths)
  const environments = project.environments === undefined
    ? undefined
    : await Promise.all(records(project.environments, 'project environments').map(async environment => {
      if (environment.kind !== 'local') return environment
      return {
        ...environment,
        path: await authorizeChangedPath(
          environment.path,
          currentPaths,
          webContentsId,
          folders,
          target,
          authorizedPaths,
        ),
      }
    }))
  for (const authorizedPath of authorizedPaths) {
    await folders.requireProjectFolder(webContentsId, authorizedPath, target, true)
  }
  return {
    ...project,
    path,
    ...(environments ? { environments } : {}),
  }
}

async function authorizeChangedPath(
  value: unknown,
  currentPaths: ReadonlySet<string>,
  webContentsId: number,
  folders: ProjectFolderAuthorizer,
  target: ProjectFolderGrantTarget,
  authorizedPaths: Set<string>,
): Promise<unknown> {
  if (typeof value !== 'string' || value.length === 0 || currentPaths.has(value)) return value
  const path = await folders.requireProjectFolder(webContentsId, value, target)
  authorizedPaths.add(path)
  return path
}

function localProjectPaths(project: RecordLike | undefined): string[] {
  if (!project) return []
  const paths: string[] = []
  if (typeof project.path === 'string' && project.path.length > 0) paths.push(project.path)
  if (Array.isArray(project.environments)) {
    for (const rawEnvironment of project.environments) {
      const environment = record(rawEnvironment, 'project environment')
      if (environment.kind === 'local' && typeof environment.path === 'string' && environment.path.length > 0) {
        paths.push(environment.path)
      }
    }
  }
  return paths
}

function record(value: unknown, label: string): RecordLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value as RecordLike
}

function records(value: unknown, label: string): RecordLike[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value.map(item => record(item, label))
}
