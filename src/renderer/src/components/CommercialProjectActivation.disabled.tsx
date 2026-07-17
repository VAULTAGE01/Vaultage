import type { EnvProject } from '../types'

interface Props {
  projects: EnvProject[]
  activeProjectIds: string[]
  selectedProjectId: string | null
  creating: boolean
  onActivate: (projectId: string, replaceProjectId?: string) => Promise<void>
  creationReplacementProjectId?: string
  onCreationReplacementChange?: (projectId: string) => void
}

/** Community builds have no project activation limit or commercial surface. */
export default function CommercialProjectActivation(_props: Props) {
  return null
}

export function useCommercialProjectCreationPolicy(
  projects: EnvProject[],
  _explicitActiveProjectIds: string[],
  _replacementProjectId?: string,
) {
  return {
    activeProjectIds: new Set(projects.map(project => project.id)),
    requiresReplacement: false,
    canCreate: true,
    blockedMessage: null,
  }
}
