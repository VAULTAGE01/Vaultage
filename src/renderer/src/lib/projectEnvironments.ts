import type { EnvEntry, EnvProject, EnvProjectEnvironment, Provider } from '../types'

export type ProjectEnvironmentStatus = 'ready' | 'needs-mapping' | 'needs-target' | 'planned'

export interface ProjectEnvironmentDisplay {
  id: string
  name: string
  scope: string
  kind: EnvProjectEnvironment['kind']
  entries: EnvEntry[]
  path?: string
  providerId?: string
  providerEnvName?: string
  syncRule?: EnvProjectEnvironment['syncRule']
  configured: boolean
  status: ProjectEnvironmentStatus
  detail: string
  targetLabel: string
  lastSyncAt?: string
}

const DEFAULT_ENVIRONMENT_ROWS: Array<Pick<ProjectEnvironmentDisplay, 'id' | 'name' | 'scope' | 'kind'>> = [
  { id: 'default-local', name: 'Local', scope: 'development', kind: 'local' },
  { id: 'default-staging', name: 'Staging', scope: 'staging', kind: 'cloud' },
  { id: 'default-production', name: 'Production', scope: 'production', kind: 'cloud' },
]

export function projectLocalEnvironmentId(projectId: string): string {
  return `${projectId}:local`
}

export function legacyLocalEnvironment(project: EnvProject): EnvProjectEnvironment {
  return {
    id: projectLocalEnvironmentId(project.id),
    name: 'Local',
    scope: 'development',
    kind: 'local',
    path: project.path,
    entries: project.entries ?? [],
    addToGitignore: project.addToGitignore,
    manualScanFiles: project.manualScanFiles,
    lastSyncAt: project.lastExportAt,
  }
}

export function ensureProjectEnvironments(project: EnvProject): EnvProject {
  const environments = Array.isArray(project.environments) ? project.environments : []
  if (environments.some(environment => environment.kind === 'local')) return project
  return {
    ...project,
    environments: [legacyLocalEnvironment(project), ...environments],
  }
}

export function getProjectEnvironments(project: EnvProject): EnvProjectEnvironment[] {
  const normalised = ensureProjectEnvironments(project)
  return normalised.environments ?? [legacyLocalEnvironment(project)]
}

export function projectLocalEnvironment(project: EnvProject): EnvProjectEnvironment {
  return getProjectEnvironments(project).find(environment => environment.kind === 'local') ?? legacyLocalEnvironment(project)
}

export function withLocalProjectEnvironment(
  project: EnvProject,
  patch: {
    path: string
    entries: EnvEntry[]
    addToGitignore: boolean
    manualScanFiles?: string[]
    lastSyncAt?: string
  },
): EnvProject {
  const environments = getProjectEnvironments(project)
  const localId = environments.find(environment => environment.kind === 'local')?.id ?? projectLocalEnvironmentId(project.id)
  const localEnvironment: EnvProjectEnvironment = {
    ...legacyLocalEnvironment(project),
    ...environments.find(environment => environment.id === localId),
    id: localId,
    name: 'Local',
    scope: 'development',
    kind: 'local',
    path: patch.path,
    entries: patch.entries,
    addToGitignore: patch.addToGitignore,
    manualScanFiles: patch.manualScanFiles,
    lastSyncAt: patch.lastSyncAt ?? project.lastExportAt,
  }

  return {
    ...project,
    path: patch.path,
    entries: patch.entries,
    addToGitignore: patch.addToGitignore,
    manualScanFiles: patch.manualScanFiles,
    lastExportAt: patch.lastSyncAt ?? project.lastExportAt,
    environments: [
      localEnvironment,
      ...environments.filter(environment => environment.id !== localId),
    ],
  }
}

export function withProjectEnvironment(project: EnvProject, environment: EnvProjectEnvironment): EnvProject {
  if (environment.kind === 'local') {
    return withLocalProjectEnvironment(project, {
      path: environment.path ?? project.path,
      entries: environment.entries ?? [],
      addToGitignore: environment.addToGitignore ?? project.addToGitignore,
      manualScanFiles: environment.manualScanFiles,
      lastSyncAt: environment.lastSyncAt,
    })
  }

  const environments = getProjectEnvironments(project)
  const nextEnvironment: EnvProjectEnvironment = {
    ...environment,
    entries: environment.entries ?? [],
  }
  const exists = environments.some(item => item.id === nextEnvironment.id)

  return {
    ...project,
    environments: exists
      ? environments.map(item => item.id === nextEnvironment.id ? nextEnvironment : item)
      : [...environments, nextEnvironment],
  }
}

export function getProjectEnvironmentDisplays(
  project: EnvProject,
  providers: Provider[] = [],
): ProjectEnvironmentDisplay[] {
  const providerById = new Map(providers.map(provider => [provider.id, provider]))
  const configured = getProjectEnvironments(project)
  const usedIds = new Set<string>()

  const displays = DEFAULT_ENVIRONMENT_ROWS.map(defaultRow => {
    const match = configured.find(environment =>
      environment.kind === defaultRow.kind &&
      (environment.scope === defaultRow.scope || environment.name.toLowerCase() === defaultRow.name.toLowerCase())
    )
    if (!match) return placeholderDisplay(defaultRow)
    usedIds.add(match.id)
    return environmentDisplay(match, providerById)
  })

  for (const environment of configured) {
    if (!usedIds.has(environment.id)) displays.push(environmentDisplay(environment, providerById))
  }

  return displays
}

export function projectPrimaryLocalPath(project: EnvProject): string {
  return projectLocalEnvironment(project).path ?? project.path
}

function placeholderDisplay(
  row: Pick<ProjectEnvironmentDisplay, 'id' | 'name' | 'scope' | 'kind'>,
): ProjectEnvironmentDisplay {
  return {
    ...row,
    entries: [],
    configured: false,
    status: 'planned',
    detail: row.kind === 'local' ? 'Attach a local folder' : 'Connect a cloud target',
    targetLabel: row.kind === 'local' ? 'No local folder' : 'No provider linked',
  }
}

function environmentDisplay(
  environment: EnvProjectEnvironment,
  providerById: Map<string, Provider>,
): ProjectEnvironmentDisplay {
  const entries = environment.entries ?? []
  const readyCount = entries.filter(entry => entry.envKey && entry.secretId && entry.fieldKey).length
  const targetLabel = environment.kind === 'local'
    ? environment.path || 'No local folder'
    : providerById.get(environment.providerId ?? '')?.name ?? environment.providerEnvName ?? 'No provider linked'
  const hasTarget = environment.kind === 'local' ? Boolean(environment.path) : Boolean(environment.providerId)
  const status: ProjectEnvironmentStatus = environment.kind === 'cloud'
    ? 'planned'
    : !hasTarget
      ? 'needs-target'
      : entries.length === 0
        ? 'needs-mapping'
        : readyCount === entries.length
          ? 'ready'
          : 'needs-mapping'

  return {
    id: environment.id,
    name: environment.name,
    scope: environment.scope,
    kind: environment.kind,
    entries,
    path: environment.path,
    providerId: environment.providerId,
    providerEnvName: environment.providerEnvName,
    syncRule: environment.syncRule,
    configured: true,
    status,
    detail: environment.kind === 'cloud'
      ? `Configuration draft · ${readyCount}/${entries.length} mapped · sync not available yet`
      : entries.length === 0
        ? 'No mapped env keys'
        : `${readyCount}/${entries.length} mapped`,
    targetLabel,
    lastSyncAt: environment.lastSyncAt,
  }
}
