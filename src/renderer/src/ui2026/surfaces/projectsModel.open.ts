import type { EnvEntry, EnvProject } from '@/types'

export type ProjectSearchEntry = {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly detail: string
  readonly kind: 'project' | 'mapping'
}

export type ProjectSurfaceSummary = {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly mappingCount: number
  readonly readyMappingCount: number
  readonly status: string
  readonly lastExportAt?: string
}

export type ProjectsSurfaceModel = {
  readonly projectCount: number
  readonly mappingCount: number
  readonly readyMappingCount: number
  readonly readyProjectCount: number
  readonly needsAttentionCount: number
  readonly lastExportAt?: string
  readonly projects: readonly ProjectSurfaceSummary[]
}

function readyEntry(entry: EnvEntry): boolean {
  return Boolean(entry.envKey && entry.secretId && entry.fieldKey)
}

export function readyEntryCount(project: EnvProject): number {
  return project.entries.filter(readyEntry).length
}

export function projectStatus(project: EnvProject): string {
  if (!project.path) return 'Needs a local folder'
  if (project.entries.length === 0) return 'Needs env mappings'
  const ready = readyEntryCount(project)
  if (ready < project.entries.length) return `${ready}/${project.entries.length} mappings ready`
  return project.lastExportAt ? `Exported ${formatProjectDate(project.lastExportAt)}` : 'Ready to export'
}

function formatProjectDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function summaryForProject(project: EnvProject): ProjectSurfaceSummary {
  return {
    id: project.id,
    name: project.name,
    path: project.path || 'No local folder selected',
    mappingCount: project.entries.length,
    readyMappingCount: readyEntryCount(project),
    status: projectStatus(project),
    lastExportAt: project.lastExportAt,
  }
}

export function buildProjectsSurfaceModel(projects: readonly EnvProject[]): ProjectsSurfaceModel {
  const summaries = projects.map(summaryForProject)
  const lastExportAt = summaries
    .map(project => project.lastExportAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
  return {
    projectCount: summaries.length,
    mappingCount: summaries.reduce((total, project) => total + project.mappingCount, 0),
    readyMappingCount: summaries.reduce((total, project) => total + project.readyMappingCount, 0),
    readyProjectCount: summaries.filter(project => project.status === 'Ready to export' || project.status.startsWith('Exported ')).length,
    needsAttentionCount: summaries.filter(project => project.status !== 'Ready to export' && !project.status.startsWith('Exported ')).length,
    lastExportAt,
    projects: summaries,
  }
}

export function projectsSearchEntries(projects: readonly EnvProject[]): readonly ProjectSearchEntry[] {
  return projects.flatMap(project => [
    {
      id: `project:${project.id}`,
      projectId: project.id,
      title: project.name,
      detail: project.path || 'No local folder selected',
      kind: 'project' as const,
    },
    ...project.entries.map((entry, index) => ({
      id: `mapping:${project.id}:${entry.envKey || index}`,
      projectId: project.id,
      title: entry.envKey || 'Unnamed mapping',
      detail: `${project.name} · ${entry.secretId && entry.fieldKey ? `Mapped Vault field: ${entry.fieldKey}` : 'Incomplete mapping'}`,
      kind: 'mapping' as const,
    })),
  ])
}

export function filterProjectsSearchEntries(
  entries: readonly ProjectSearchEntry[],
  query: string,
): readonly ProjectSearchEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return entries
  return entries.filter(entry => `${entry.title} ${entry.detail}`.toLocaleLowerCase().includes(normalized))
}
