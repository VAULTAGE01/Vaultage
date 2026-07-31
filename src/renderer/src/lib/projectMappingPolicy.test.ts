import { describe, expect, it } from 'vitest'
import type { EnvProject } from '../types'
import { buildProjectMappingUpdates } from './projectMappingPolicy'

const projects: EnvProject[] = ['project-a', 'project-b', 'project-c'].map(id => ({
  id,
  name: id,
  path: `/${id}`,
  entries: id === 'project-c'
    ? [{ secretId: 'secret-1', envKey: 'OLD_KEY', fieldKey: 'token' }]
    : [],
  addToGitignore: true,
}))

describe('Free secret mapping batches', () => {
  it('updates every changed Project without an activation-slot filter', () => {
    const updates = buildProjectMappingUpdates(projects, [
      { projectId: 'project-a', enabled: true, envKey: 'API_TOKEN', fieldKey: 'token' },
      { projectId: 'project-b', enabled: false, envKey: 'API_TOKEN', fieldKey: 'token' },
      { projectId: 'project-c', enabled: false, envKey: 'OLD_KEY', fieldKey: 'token' },
    ], 'secret-1')

    expect(updates.map(project => project.id)).toEqual(['project-a', 'project-c'])
    expect(updates[0]?.entries).toEqual([{ secretId: 'secret-1', envKey: 'API_TOKEN', fieldKey: 'token' }])
    expect(updates[1]?.entries).toEqual([])
  })

  it('does not submit unchanged Projects', () => {
    const updates = buildProjectMappingUpdates(projects, [
      { projectId: 'project-c', enabled: true, envKey: 'OLD_KEY', fieldKey: 'token' },
    ], 'secret-1')

    expect(updates).toEqual([])
  })

  it('preserves mapping order and stable field identity on a no-op save', () => {
    const project: EnvProject = {
      id: 'project-a', name: 'A', path: '/a', addToGitignore: true,
      entries: [
        { secretId: 'secret-1', envKey: 'API_TOKEN', fieldId: 'field-1', fieldKey: 'token' },
        { secretId: 'secret-2', envKey: 'OTHER_TOKEN', fieldKey: 'token' },
      ],
    }
    const updates = buildProjectMappingUpdates([project], [
      { projectId: 'project-a', enabled: true, envKey: 'API_TOKEN', fieldKey: 'token' },
    ], 'secret-1')

    expect(updates).toEqual([])
    expect(project.entries[0]).toMatchObject({ fieldId: 'field-1', envKey: 'API_TOKEN' })
  })

  it('updates the canonical Local environment and its legacy mirror together', () => {
    const project: EnvProject = {
      id: 'project-a', name: 'A', path: '/legacy', entries: [], addToGitignore: true,
      environments: [{
        id: 'project-a:local', name: 'Local', scope: 'development', kind: 'local',
        path: '/current', entries: [], addToGitignore: false,
      }],
    }
    const updates = buildProjectMappingUpdates([project], [
      { projectId: 'project-a', enabled: true, envKey: 'API_TOKEN', fieldId: 'field-2', fieldKey: 'token' },
    ], 'secret-1')

    expect(updates).toHaveLength(1)
    expect(updates[0]?.entries).toEqual([
      { secretId: 'secret-1', envKey: 'API_TOKEN', fieldId: 'field-2', fieldKey: 'token' },
    ])
    expect(updates[0]?.environments?.[0]).toMatchObject({
      id: 'project-a:local', path: '/current', addToGitignore: false,
      entries: [{ secretId: 'secret-1', envKey: 'API_TOKEN', fieldId: 'field-2', fieldKey: 'token' }],
    })
  })
})
