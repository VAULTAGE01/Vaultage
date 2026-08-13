import { describe, expect, it } from 'vitest'
import {
  dashboardOnboardingSessionKey,
  dashboardOnboardingStorageKey,
  readDashboardOnboardingSessionDismissal,
  readDashboardOnboardingSkip,
  resolveDashboardOnboardingProgress,
  writeDashboardOnboardingSessionDismissal,
  writeDashboardOnboardingSkip,
} from './dashboardOnboardingModel'

type MemoryStorage = {
  readonly values: Map<string, string>
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('dashboard onboarding model', () => {
  it('resolves each surface from its exact milestone sequence', () => {
    expect(
      resolveDashboardOnboardingProgress({
        surface: 'vault',
        completed: ['vault-ready'],
      }),
    ).toEqual({
      surface: 'vault',
      milestones: [
        { id: 'vault-ready', label: 'Vault ready', completed: true },
        { id: 'first-secret-added', label: 'Add your first secret', completed: false },
      ],
      completedCount: 1,
      nextStep: { id: 'first-secret-added', label: 'Add your first secret', completed: false },
    })

    expect(
      resolveDashboardOnboardingProgress({
        surface: 'projects',
        completed: ['project-scanned-or-imported', 'vault-secrets-linked'],
      }).nextStep,
    ).toBeNull()
  })

  it('preserves exact milestone status instead of inferring completion by position', () => {
    const progress = resolveDashboardOnboardingProgress({
      surface: 'vault',
      completed: ['first-secret-added'],
    })

    expect(progress.completedCount).toBe(1)
    expect(progress.milestones).toEqual([
      { id: 'vault-ready', label: 'Vault ready', completed: false },
      { id: 'first-secret-added', label: 'Add your first secret', completed: true },
    ])
    expect(progress.nextStep).toEqual({
      id: 'vault-ready',
      label: 'Vault ready',
      completed: false,
    })
  })

  it('stores Skip as a versioned, surface-scoped preference', () => {
    const storage = memoryStorage()

    expect(readDashboardOnboardingSkip(storage, 'vault')).toEqual({
      kind: 'available',
      skipped: false,
    })
    expect(writeDashboardOnboardingSkip(storage, 'vault')).toEqual({
      kind: 'stored',
    })
    expect(storage.values.get(dashboardOnboardingStorageKey('vault'))).toBe('skipped')
    expect(readDashboardOnboardingSkip(storage, 'vault')).toEqual({
      kind: 'available',
      skipped: true,
    })
    expect(readDashboardOnboardingSkip(storage, 'projects')).toEqual({
      kind: 'available',
      skipped: false,
    })
  })

  it('stores Close separately for the current application session', () => {
    const sessionStorage = memoryStorage()

    expect(readDashboardOnboardingSessionDismissal(sessionStorage, 'vault')).toEqual({
      kind: 'available',
      dismissed: false,
    })
    expect(writeDashboardOnboardingSessionDismissal(sessionStorage, 'vault')).toEqual({
      kind: 'stored',
    })
    expect(sessionStorage.values.get(dashboardOnboardingSessionKey('vault'))).toBe('closed')
    expect(readDashboardOnboardingSessionDismissal(sessionStorage, 'vault')).toEqual({
      kind: 'available',
      dismissed: true,
    })
    expect(readDashboardOnboardingSessionDismissal(sessionStorage, 'projects')).toEqual({
      kind: 'available',
      dismissed: false,
    })
  })

  it('fails open without throwing when durable browser storage is unavailable', () => {
    const unavailable = {
      getItem: (): string | null => {
        throw new Error('blocked storage')
      },
      setItem: (): void => {
        throw new Error('full storage')
      },
    }

    expect(readDashboardOnboardingSkip(undefined, 'vault')).toEqual({
      kind: 'unavailable',
      skipped: false,
    })
    expect(readDashboardOnboardingSkip(unavailable, 'vault')).toEqual({
      kind: 'unavailable',
      skipped: false,
    })
    expect(writeDashboardOnboardingSkip(unavailable, 'vault')).toEqual({
      kind: 'unavailable',
    })
  })
})
