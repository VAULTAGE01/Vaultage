import { describe, expect, it } from 'vitest'
import type { EnvProject } from '@/types'
import {
  buildProjectsSurfaceModel,
  filterProjectsSearchEntries,
  projectsSearchEntries,
} from './projectsModel.open'

const project = (overrides: Partial<EnvProject> = {}): EnvProject => ({
  id: 'api',
  name: 'API service',
  path: '/work/api',
  entries: [
    { envKey: 'API_KEY', secretId: 'secret-1', fieldKey: 'value' },
    { envKey: 'API_REGION', secretId: '', fieldKey: '' },
  ],
  addToGitignore: true,
  ...overrides,
})

describe('UI2026 Projects model', () => {
  it('summarizes local project readiness without introducing remote environments', () => {
    const model = buildProjectsSurfaceModel([project()])

    expect(model).toMatchObject({
      projectCount: 1,
      mappingCount: 2,
      readyMappingCount: 1,
      needsAttentionCount: 1,
      readyProjectCount: 0,
    })
    expect(model.projects[0]).toMatchObject({
      id: 'api',
      name: 'API service',
      status: '1/2 mappings ready',
    })
  })

  it('filters project search entries by project name, path, and mapping key', () => {
    const projects = [project(), project({ id: 'web', name: 'Web app', path: '/work/web', entries: [] })]
    const entries = projectsSearchEntries(projects)

    expect(filterProjectsSearchEntries(entries, 'api')).toEqual([
      expect.objectContaining({ id: 'project:api', kind: 'project' }),
      expect.objectContaining({ id: 'mapping:api:API_KEY', kind: 'mapping' }),
      expect.objectContaining({ id: 'mapping:api:API_REGION', kind: 'mapping' }),
    ])
    expect(filterProjectsSearchEntries(entries, '/work/web')).toEqual([
      expect.objectContaining({ id: 'project:web', kind: 'project' }),
    ])
    expect(filterProjectsSearchEntries(entries, 'value')).toEqual([
      expect.objectContaining({ id: 'mapping:api:API_KEY', kind: 'mapping' }),
    ])
    expect(filterProjectsSearchEntries(entries, '   ')).toEqual(entries)
  })
})
