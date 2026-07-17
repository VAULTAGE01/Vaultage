import { describe, expect, it } from 'vitest'
import { projectExportDisplayText, resolveStoredProjectEnvExport } from './projectAccessPolicy'

describe('stored project path authorization', () => {
  const vault = {
    envProjects: [
      {
        id: 'project-1',
        path: '/project/default',
        entries: [],
        addToGitignore: false,
        environments: [
          { id: 'environment-1', kind: 'local', path: '/project/development', entries: [], addToGitignore: true },
          { id: 'environment-2', kind: 'cloud', path: '/project/production', entries: [] },
        ],
      },
    ],
  }

  it('derives the exact stored local path, mappings, and gitignore policy', () => {
    const configured = {
      envProjects: [{
        id: 'project-1', path: '/legacy', entries: [], addToGitignore: false,
        environments: [{
          id: 'environment-local', name: 'Local', scope: 'development', kind: 'local',
          path: '/project/development',
          entries: [{ envKey: 'API_KEY', secretId: 'secret-1', fieldKey: 'value' }],
          addToGitignore: true,
        }],
      }],
    }
    expect(resolveStoredProjectEnvExport(configured, 'project-1', 'environment-local')).toEqual({
      projectId: 'project-1', projectName: 'Project', environmentId: 'environment-local', environmentName: 'Local', path: '/project/development',
      selections: [{ envKey: 'API_KEY', secretId: 'secret-1', fieldKey: 'value' }],
      addToGitignore: true,
    })
  })

  it('supports the deterministic legacy local environment only when no stored local row exists', () => {
    expect(resolveStoredProjectEnvExport({
      envProjects: [{ id: 'project-1', path: '/legacy', entries: [], addToGitignore: false }],
    }, 'project-1', 'project-1:local')).toMatchObject({ path: '/legacy', selections: [], addToGitignore: false })
    expect(() => resolveStoredProjectEnvExport(vault, 'project-1', 'project-1:local'))
      .toThrow('no longer exists')
  })

  it('rejects cloud environments, substituted identities, and missing projects', () => {
    expect(() => resolveStoredProjectEnvExport(vault, 'project-1', 'environment-2'))
      .toThrow('Only a stored local environment')
    expect(() => resolveStoredProjectEnvExport(vault, 'project-1', 'substituted'))
      .toThrow('no longer exists')
    expect(() => resolveStoredProjectEnvExport(vault, 'missing', 'environment-1'))
      .toThrow('no longer exists')
  })

  it('fails closed on malformed vault project data', () => {
    expect(() => resolveStoredProjectEnvExport({}, 'project-1', 'environment-1'))
      .toThrow('Invalid environment projects')
    expect(() => resolveStoredProjectEnvExport({ envProjects: [null] }, 'project-1', 'environment-1'))
      .toThrow('Invalid environment projects')
  })

  it('escapes control characters in main-owned export display text', () => {
    expect(projectExportDisplayText('Project\nDestination: /attacker\u007f', 'fallback'))
      .toBe('Project\\u000ADestination: /attacker\\u007F')
  })
})
