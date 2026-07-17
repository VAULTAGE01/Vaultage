import { describe, expect, it } from 'vitest'
import type { EnvProject } from '../types'
import {
  ensureProjectEnvironments,
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

  it('renders default local, staging, and production rows', () => {
    const displays = getProjectEnvironmentDisplays(legacyProject)

    expect(displays.map(environment => [environment.name, environment.kind, environment.configured])).toEqual([
      ['Local', 'local', true],
      ['Staging', 'cloud', false],
      ['Production', 'cloud', false],
    ])
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
      'Staging',
    ])
    expect(getProjectEnvironmentDisplays(project).find(environment => environment.name === 'Staging')).toMatchObject({
      status: 'planned',
      detail: expect.stringContaining('sync not available yet'),
    })
  })
})
