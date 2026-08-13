import type { EnvEntry, EnvProject } from '@/types'
import type { DashboardOnboardingState } from '../primitives/dashboardOnboardingModel'

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

function hasScanOrImportEvidence(project: EnvProject): boolean {
  if (hasText(project.path) || project.manualScanFiles?.some(hasText)) return true
  return (project.environments ?? []).some(environment => (
    environment.kind === 'local'
    && (hasText(environment.path) || environment.manualScanFiles?.some(hasText) === true)
  ))
}

function hasVaultLink(entry: EnvEntry): boolean {
  return hasText(entry.secretId) && hasText(entry.fieldKey)
}

function projectHasVaultLink(project: EnvProject): boolean {
  if (project.entries.some(hasVaultLink)) return true
  return (project.environments ?? []).some(environment => environment.entries.some(hasVaultLink))
}

export function projectsOnboardingState(
  projects: readonly EnvProject[],
): DashboardOnboardingState {
  const completed: ('project-scanned-or-imported' | 'vault-secrets-linked')[] = []
  if (projects.some(hasScanOrImportEvidence)) completed.push('project-scanned-or-imported')
  if (projects.some(projectHasVaultLink)) completed.push('vault-secrets-linked')
  return { surface: 'projects', completed }
}
