import type { EnvEntry, EnvProject, EnvProjectEnvironment, Provider } from '../types'

export type ProjectEnvironmentStatus = 'ready' | 'needs-mapping' | 'needs-target' | 'unavailable'

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
  providerBinding?: EnvProjectEnvironment['providerBinding']
}

const STANDARD_CLOUD_ENVIRONMENTS = [
  { name: 'Dev', scope: 'development' },
  { name: 'Stg', scope: 'staging' },
  { name: 'Prod', scope: 'production' },
] as const

export function projectLocalEnvironmentId(projectId: string): string {
  return `${projectId}:local`
}

export function projectCloudEnvironmentId(projectId: string, scope: string): string {
  return `${projectId}:${scope}`
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
    id: environment.providerBinding
      ? projectCloudEnvironmentId(project.id, environment.scope)
      : environment.id,
    entries: environment.entries ?? [],
  }
  const matchingIndex = environments.findIndex(item => (
    item.id === nextEnvironment.id
    || (nextEnvironment.providerBinding && item.kind === 'cloud' && item.scope === nextEnvironment.scope)
  ))
  const sameSlot = (item: EnvProjectEnvironment): boolean => (
    item.id === nextEnvironment.id
    || Boolean(nextEnvironment.providerBinding && item.kind === 'cloud' && item.scope === nextEnvironment.scope)
  )
  const remaining = environments.filter(item => !sameSlot(item))
  const insertAt = matchingIndex < 0 ? remaining.length : Math.min(matchingIndex, remaining.length)
  remaining.splice(insertAt, 0, nextEnvironment)

  return {
    ...project,
    environments: remaining,
  }
}

export function getProjectEnvironmentDisplays(
  project: EnvProject,
  providers: Provider[] = [],
): ProjectEnvironmentDisplay[] {
  const providerById = new Map(providers.map(provider => [provider.id, provider]))
  const configured = getProjectEnvironments(project)
  const local = configured.find(environment => environment.kind === 'local') ?? legacyLocalEnvironment(project)
  const standardCloud = STANDARD_CLOUD_ENVIRONMENTS.map(slot => {
    const existing = configured.find(environment => environment.kind === 'cloud' && environment.scope === slot.scope)
    if (existing) {
      return environmentDisplay({ ...existing, name: slot.name }, providerById, true)
    }
    return environmentDisplay({
      id: projectCloudEnvironmentId(project.id, slot.scope),
      name: slot.name,
      scope: slot.scope,
      kind: 'cloud',
      entries: [],
      syncRule: 'manual',
    }, providerById, false)
  })
  return [environmentDisplay({ ...local, name: 'Local' }, providerById, true), ...standardCloud]
}

export function getProjectEnvironment(
  project: EnvProject,
  environmentId: string,
): EnvProjectEnvironment | null {
  const persisted = getProjectEnvironments(project).find(environment => environment.id === environmentId)
  if (persisted) return persisted
  const display = getProjectEnvironmentDisplays(project).find(environment => environment.id === environmentId)
  if (!display || display.kind !== 'cloud') return null
  return {
    id: display.id,
    name: display.name,
    scope: display.scope,
    kind: display.kind,
    entries: display.entries,
    providerId: display.providerId,
    providerEnvName: display.providerEnvName,
    syncRule: display.syncRule ?? 'manual',
    lastSyncAt: display.lastSyncAt,
    providerBinding: display.providerBinding,
  }
}

export function projectPrimaryLocalPath(project: EnvProject): string {
  return projectLocalEnvironment(project).path ?? project.path
}

function environmentDisplay(
  environment: EnvProjectEnvironment,
  providerById: Map<string, Provider>,
  configured: boolean,
): ProjectEnvironmentDisplay {
  const entries = environment.entries ?? []
  const readyCount = entries.filter(entry => entry.envKey && entry.secretId && entry.fieldKey).length
  const targetLabel = environment.kind === 'local'
    ? environment.path || 'No local folder'
    : providerById.get(environment.providerId ?? '')?.name ?? environment.providerEnvName ?? 'No provider linked'
  const provider = providerById.get(environment.providerId ?? '')
  const hasTarget = environment.kind === 'local'
    ? Boolean(environment.path)
    : Boolean(environment.providerId && environment.providerBinding)
  const providerReady = provider?.connectionStatus === 'verified'
  const status: ProjectEnvironmentStatus = environment.kind === 'cloud' && environment.providerId && !providerReady
    ? 'unavailable'
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
    configured,
    status,
    detail: environment.kind === 'cloud' && environment.providerId && !providerReady
      ? `Saved configuration only · ${readyCount}/${entries.length} mapped · cloud push/pull unavailable`
      : environment.kind === 'cloud' && !hasTarget
        ? 'Bind one verified provider target'
        : environment.kind === 'cloud'
          ? `${readyCount}/${entries.length} mapped · explicit approval only`
      : entries.length === 0
        ? 'No mapped env keys'
        : `${readyCount}/${entries.length} mapped`,
    targetLabel,
    lastSyncAt: environment.lastSyncAt,
    providerBinding: environment.providerBinding,
  }
}
