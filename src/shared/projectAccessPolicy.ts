type RecordLike = Record<string, unknown>

export interface StoredProjectEnvExport {
  projectId: string
  projectName: string
  environmentId: string
  environmentName: string
  path: string
  selections: unknown[]
  addToGitignore: boolean
}

/**
 * Resolves every security-relevant plaintext export input from the persisted
 * vault. Renderer-supplied identity selects a record; it never supplies the
 * path, mappings, or gitignore behavior that main commits.
 */
export function resolveStoredProjectEnvExport(
  rawVault: unknown,
  projectId: string,
  environmentId: string,
): StoredProjectEnvExport {
  const vault = record(rawVault, 'vault')
  const projects = records(vault.envProjects, 'environment projects')
  const project = projects.find(candidate => candidate.id === projectId)
  if (!project) throw new Error('Environment project no longer exists')

  const environments = project.environments === undefined
    ? []
    : records(project.environments, 'project environments')
  const selected = environments.find(environment => environment.id === environmentId)
  if (selected) {
    if (selected.kind !== 'local') throw new Error('Only a stored local environment can be exported to .env')
    return storedExport(projectId, label(project.name, 'Project'), environmentId, label(selected.name, 'Local'), selected, project.addToGitignore)
  }

  const legacyEnvironmentId = `${projectId}:local`
  const hasStoredLocal = environments.some(environment => environment.kind === 'local')
  if (environmentId !== legacyEnvironmentId || hasStoredLocal) {
    throw new Error('Local project environment no longer exists')
  }
  return storedExport(projectId, label(project.name, 'Project'), legacyEnvironmentId, 'Local', {
    path: project.path,
    entries: project.entries,
    addToGitignore: project.addToGitignore,
  }, project.addToGitignore)
}

function storedExport(
  projectId: string,
  projectName: string,
  environmentId: string,
  environmentName: string,
  environment: RecordLike,
  projectGitignore: unknown,
): StoredProjectEnvExport {
  const path = environment.path
  if (typeof path !== 'string' || path.length < 1 || path.length > 4096 || path.includes('\0')) {
    throw new Error('Stored local environment path is invalid')
  }
  if (!Array.isArray(environment.entries)) throw new Error('Stored local environment mappings are invalid')
  const rawGitignore = environment.addToGitignore ?? projectGitignore
  if (typeof rawGitignore !== 'boolean') throw new Error('Stored local environment gitignore policy is invalid')
  return {
    projectId,
    projectName,
    environmentId,
    environmentName,
    path,
    selections: environment.entries,
    addToGitignore: rawGitignore,
  }
}

export function projectExportDisplayText(value: unknown, fallback: string, maxLength = 240): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  const escaped = raw.replace(/[\u0000-\u001f\u007f]/gu, character => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`
  ))
  return escaped.slice(0, maxLength)
}

function label(value: unknown, fallback: string): string {
  return projectExportDisplayText(value, fallback, 160)
}

function record(value: unknown, label: string): RecordLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value as RecordLike
}

function records(value: unknown, label: string): RecordLike[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value.map(item => record(item, label))
}
