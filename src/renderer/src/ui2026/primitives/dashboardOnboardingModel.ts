export const VAULT_ONBOARDING_MILESTONES = [
  { id: 'vault-ready', label: 'Vault ready' },
  { id: 'first-secret-added', label: 'Add your first secret' },
] as const

export const PROJECTS_ONBOARDING_MILESTONES = [
  { id: 'project-scanned-or-imported', label: 'Project scanned or imported' },
  { id: 'vault-secrets-linked', label: 'Link vault secrets' },
] as const

export type DashboardSurface = 'vault' | 'projects'
export type VaultOnboardingMilestoneId = (typeof VAULT_ONBOARDING_MILESTONES)[number]['id']
export type ProjectsOnboardingMilestoneId = (typeof PROJECTS_ONBOARDING_MILESTONES)[number]['id']
type DashboardOnboardingMilestoneId = VaultOnboardingMilestoneId | ProjectsOnboardingMilestoneId

export type DashboardOnboardingState =
  | {
      readonly surface: 'vault'
      readonly completed: readonly VaultOnboardingMilestoneId[]
    }
  | {
      readonly surface: 'projects'
      readonly completed: readonly ProjectsOnboardingMilestoneId[]
    }

export type DashboardOnboardingMilestone = {
  readonly id: DashboardOnboardingMilestoneId
  readonly label: string
  readonly completed: boolean
}

export type DashboardOnboardingProgress = {
  readonly surface: DashboardSurface
  readonly milestones: readonly DashboardOnboardingMilestone[]
  readonly completedCount: number
  readonly nextStep: DashboardOnboardingMilestone | null
}

export type DashboardOnboardingStorage = Pick<Storage, 'getItem' | 'setItem'>

export type DashboardOnboardingStorageRead =
  | { readonly kind: 'available'; readonly skipped: boolean }
  | { readonly kind: 'unavailable'; readonly skipped: false }

export type DashboardOnboardingStorageWrite =
  | { readonly kind: 'stored' }
  | { readonly kind: 'unavailable' }

export type DashboardOnboardingSessionRead =
  | { readonly kind: 'available'; readonly dismissed: boolean }
  | { readonly kind: 'unavailable'; readonly dismissed: false }

function progressForMilestones<TId extends DashboardOnboardingMilestoneId>(
  surface: DashboardSurface,
  milestones: readonly { readonly id: TId; readonly label: string }[],
  completed: readonly TId[],
): DashboardOnboardingProgress {
  const completedMilestones = new Set(completed)
  const resolvedMilestones: readonly DashboardOnboardingMilestone[] = milestones.map((milestone) => ({
    ...milestone,
    completed: completedMilestones.has(milestone.id),
  }))
  const nextStep = resolvedMilestones.find((milestone) => !milestone.completed) ?? null
  return {
    surface,
    milestones: resolvedMilestones,
    completedCount: resolvedMilestones.filter((milestone) => milestone.completed).length,
    nextStep,
  }
}

export function resolveDashboardOnboardingProgress(
  state: DashboardOnboardingState,
): DashboardOnboardingProgress {
  switch (state.surface) {
    case 'vault':
      return progressForMilestones('vault', VAULT_ONBOARDING_MILESTONES, state.completed)
    case 'projects':
      return progressForMilestones('projects', PROJECTS_ONBOARDING_MILESTONES, state.completed)
    default: {
      const unexpectedState: never = state
      throw new TypeError(`Unexpected dashboard onboarding state: ${String(unexpectedState)}`)
    }
  }
}

export function dashboardOnboardingStorageKey(surface: DashboardSurface): string {
  return `vaultage.ui26.dashboard-onboarding.v1.${surface}.skipped`
}

export function dashboardOnboardingSessionKey(surface: DashboardSurface): string {
  return `vaultage.ui26.dashboard-onboarding.v1.${surface}.session-closed`
}

export function readDashboardOnboardingSessionDismissal(
  storage: DashboardOnboardingStorage | undefined,
  surface: DashboardSurface,
): DashboardOnboardingSessionRead {
  if (storage === undefined) {
    return { kind: 'unavailable', dismissed: false }
  }

  try {
    return {
      kind: 'available',
      dismissed: storage.getItem(dashboardOnboardingSessionKey(surface)) === 'closed',
    }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: 'unavailable', dismissed: false }
    }
    throw error
  }
}

export function writeDashboardOnboardingSessionDismissal(
  storage: DashboardOnboardingStorage | undefined,
  surface: DashboardSurface,
): DashboardOnboardingStorageWrite {
  if (storage === undefined) {
    return { kind: 'unavailable' }
  }

  try {
    storage.setItem(dashboardOnboardingSessionKey(surface), 'closed')
    return { kind: 'stored' }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: 'unavailable' }
    }
    throw error
  }
}

export function readDashboardOnboardingSkip(
  storage: DashboardOnboardingStorage | undefined,
  surface: DashboardSurface,
): DashboardOnboardingStorageRead {
  if (storage === undefined) {
    return { kind: 'unavailable', skipped: false }
  }

  try {
    return {
      kind: 'available',
      skipped: storage.getItem(dashboardOnboardingStorageKey(surface)) === 'skipped',
    }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: 'unavailable', skipped: false }
    }
    throw error
  }
}

export function writeDashboardOnboardingSkip(
  storage: DashboardOnboardingStorage | undefined,
  surface: DashboardSurface,
): DashboardOnboardingStorageWrite {
  if (storage === undefined) {
    return { kind: 'unavailable' }
  }

  try {
    storage.setItem(dashboardOnboardingStorageKey(surface), 'skipped')
    return { kind: 'stored' }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: 'unavailable' }
    }
    throw error
  }
}
