import { describe, expect, it } from 'vitest'
import type { EnvProject } from '../types'
import {
  ensureProjectEnvironments,
  getProjectEnvironment,
  getProjectEnvironments,
  getProjectEnvironmentDisplays,
  projectLocalEnvironment,
  withLocalProjectEnvironment,
  withProjectEnvironment,
} from './projectEnvironments'

const legacyProject: EnvProject = {
  id: 'project-1',
  name: 'Billing App',
  path: '/tmp/billing',
  addToGitignore: true,
  entries: [{ envKey: 'STRIPE_API_KEY', secretId: 'secret-1', fieldKey: 'API Key' }],
}

describe('project environment helpers', () => {
  it('treats legacy project path and entries as the Local environment', () => {
    const project = ensureProjectEnvironments(legacyProject)

    expect(project.environments).toEqual([{
      id: 'project-1:local',
      name: 'Local',
      scope: 'development',
      kind: 'local',
      path: '/tmp/billing',
      entries: [{ envKey: 'STRIPE_API_KEY', secretId: 'secret-1', fieldKey: 'API Key' }],
      addToGitignore: true,
      manualScanFiles: undefined,
      lastSyncAt: undefined,
    }])
  })

  it('renders the fixed local, development, staging, and production demo rows', () => {
    const displays = getProjectEnvironmentDisplays(legacyProject)

    expect(displays.map(environment => [environment.name, environment.kind, environment.configured])).toEqual([
      ['Local', 'local', true],
      ['Dev', 'cloud', false],
      ['Stg', 'cloud', false],
      ['Prod', 'cloud', false],
    ])
    expect(getProjectEnvironment(legacyProject, 'project-1:staging')).toMatchObject({
      name: 'Stg',
      scope: 'staging',
      kind: 'cloud',
      syncRule: 'manual',
    })
  })

  it('keeps legacy fields mirrored when local environment changes', () => {
    const project = withLocalProjectEnvironment(legacyProject, {
      path: '/tmp/billing-web',
      entries: [],
      addToGitignore: false,
      lastSyncAt: '2026-06-19T15:00:00.000Z',
    })

    expect(project.path).toBe('/tmp/billing-web')
    expect(project.entries).toEqual([])
    expect(project.addToGitignore).toBe(false)
    expect(project.lastExportAt).toBe('2026-06-19T15:00:00.000Z')
    expect(projectLocalEnvironment(project)).toMatchObject({
      path: '/tmp/billing-web',
      entries: [],
      addToGitignore: false,
      lastSyncAt: '2026-06-19T15:00:00.000Z',
    })
  })

  it('adds cloud environments without disturbing the local environment', () => {
    const project = withProjectEnvironment(legacyProject, {
      id: 'env-staging',
      name: 'Staging',
      scope: 'staging',
      kind: 'cloud',
      providerId: 'provider-1',
      providerEnvName: 'preview',
      entries: [],
    })

    expect(projectLocalEnvironment(project)).toMatchObject({
      path: '/tmp/billing',
      entries: [{ envKey: 'STRIPE_API_KEY', secretId: 'secret-1', fieldKey: 'API Key' }],
    })
    expect(project.environments?.map(environment => [environment.id, environment.kind, environment.scope])).toEqual([
      ['project-1:local', 'local', 'development'],
      ['env-staging', 'cloud', 'staging'],
    ])
    expect(getProjectEnvironmentDisplays(project).filter(environment => environment.configured).map(environment => environment.name)).toEqual([
      'Local',
      'Stg',
    ])
    expect(getProjectEnvironmentDisplays(project).find(environment => environment.name === 'Stg')).toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('cloud push/pull unavailable'),
    })
  })

  it('keeps the environment rail to exactly the four demo slots', () => {
    const project = withProjectEnvironment(legacyProject, {
      id: 'env-preview',
      name: 'Preview',
      scope: 'preview',
      kind: 'cloud',
      entries: [],
    })

    expect(getProjectEnvironmentDisplays(project).map(environment => environment.name)).toEqual([
      'Local', 'Dev', 'Stg', 'Prod',
    ])
  })

  it('preserves opaque provider target metadata on a fixed project environment', () => {
    const project = withProjectEnvironment(legacyProject, {
      id: 'project-1:staging',
      name: 'Stg',
      scope: 'staging',
      kind: 'cloud',
      providerId: 'provider-one',
      entries: [],
      providerBinding: {
        kind: 'external-secret-target',
        target: 'project-1-staging',
      },
    })

    expect(getProjectEnvironments(project).find(environment => environment.id === 'project-1:staging')).toMatchObject({
      providerId: 'provider-one',
      providerBinding: {
        kind: 'external-secret-target',
        target: 'project-1-staging',
      },
    })
  })

  it('moves a legacy staging row onto the fixed project slot when a provider binding is saved', () => {
    const legacyCloud = withProjectEnvironment(legacyProject, {
      id: 'legacy-staging-id',
      name: 'Staging',
      scope: 'staging',
      kind: 'cloud',
      entries: [],
    })
    const migrated = withProjectEnvironment(legacyCloud, {
      id: 'legacy-staging-id',
      name: 'Stg',
      scope: 'staging',
      kind: 'cloud',
      providerId: 'provider-one',
      entries: [],
      providerBinding: {
        kind: 'external-secret-target',
        target: 'project-1-staging',
      },
    })

    expect(migrated.environments?.filter(environment => environment.scope === 'staging')).toEqual([
      expect.objectContaining({ id: 'project-1:staging', providerId: 'provider-one' }),
    ])
  })
})
