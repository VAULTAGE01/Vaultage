import type { EnvEntry, EnvProject } from '../types'
import { projectLocalEnvironment, withLocalProjectEnvironment } from './projectEnvironments'

export interface SecretProjectMappingDraft {
  projectId: string
  enabled: boolean
  envKey: string
  fieldId?: string
  fieldKey: string
}

/**
 * Builds the smallest main-authorized batch for secret-to-Project mapping
 * changes. Free Projects are unlimited, so every changed Project is eligible.
 */
export function buildProjectMappingUpdates(
  projects: readonly EnvProject[],
  drafts: readonly SecretProjectMappingDraft[],
  secretId: string,
): EnvProject[] {
  const updates: EnvProject[] = []
  for (const project of projects) {
    const draft = drafts.find(item => item.projectId === project.id)
    if (!draft) continue
    const localEnvironment = projectLocalEnvironment(project)
    const existingIndex = localEnvironment.entries.findIndex(entry => entry.secretId === secretId)
    const entries = localEnvironment.entries.filter(entry => entry.secretId !== secretId)
    let nextEntries = entries
    if (draft.enabled && draft.envKey.trim() && draft.fieldKey) {
      const existing = existingIndex >= 0 ? localEnvironment.entries[existingIndex] : undefined
      const nextEntry: EnvEntry = existing
        ? { ...existing, envKey: draft.envKey.trim(), fieldKey: draft.fieldKey }
        : { secretId, envKey: draft.envKey.trim(), fieldKey: draft.fieldKey }
      if (draft.fieldId) nextEntry.fieldId = draft.fieldId
      else if (existing?.fieldKey !== draft.fieldKey) delete nextEntry.fieldId
      nextEntries = [...entries]
      nextEntries.splice(existingIndex >= 0 ? Math.min(existingIndex, nextEntries.length) : nextEntries.length, 0, nextEntry)
    }
    if (!sameEntries(localEnvironment.entries, nextEntries)) {
      updates.push(withLocalProjectEnvironment(project, {
        path: localEnvironment.path ?? project.path,
        entries: nextEntries,
        addToGitignore: localEnvironment.addToGitignore ?? project.addToGitignore,
        manualScanFiles: localEnvironment.manualScanFiles,
        lastSyncAt: localEnvironment.lastSyncAt,
      }))
    }
  }
  return updates
}

function sameEntries(left: readonly EnvEntry[], right: readonly EnvEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && entry.secretId === candidate.secretId
      && entry.fieldId === candidate.fieldId
      && entry.fieldKey === candidate.fieldKey
      && entry.envKey === candidate.envKey
  })
}
