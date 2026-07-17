import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { existingProjectGrantTarget, ProjectPathCapabilityStore } from './projectCapabilities'
import { authorizeProjectPathMutation } from './projectMutationAuthorization'

const temporaryFolders: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Project path mutation authorization', () => {
  it('preserves unchanged persisted paths without requiring a new picker grant', async () => {
    const path = '/previously-authorized/project'
    const project = localProject('project-1', path)
    const command = { type: 'env-project.update' as const, project }

    await expect(authorizeProjectPathMutation(
      { envProjects: [project] }, command, 5, new ProjectPathCapabilityStore(),
    )).resolves.toEqual(command)
  })

  it('rejects renderer-substituted local paths that lack a native-picker grant', async () => {
    const substitutedPath = await temporaryFolder()
    const previous = localProject('project-1', '/previously-authorized/project')
    const changed = localProject('project-1', substitutedPath)

    await expect(authorizeProjectPathMutation(
      { envProjects: [previous] },
      { type: 'env-project.update', project: changed },
      5,
      new ProjectPathCapabilityStore(),
    )).rejects.toThrow('Project folder access expired; choose it again')
  })

  it('accepts and canonicalizes a changed path selected by the same renderer', async () => {
    const folder = await temporaryFolder()
    const capabilities = new ProjectPathCapabilityStore()
    await capabilities.grantFolder(5, folder, 'project-local-path', existingProjectGrantTarget('project-1'))
    const canonicalFolder = await realpath(folder)
    const previous = localProject('project-1', '/previously-authorized/project')

    await expect(authorizeProjectPathMutation(
      { envProjects: [previous] },
      { type: 'env-project.update', project: localProject('project-1', folder) },
      5,
      capabilities,
    )).resolves.toMatchObject({
      project: {
        path: canonicalFolder,
        environments: [{ kind: 'local', path: canonicalFolder }],
      },
    })
    await expect(authorizeProjectPathMutation(
      { envProjects: [previous] },
      { type: 'env-project.update', project: localProject('project-1', folder) },
      5,
      capabilities,
    )).rejects.toThrow('choose it again')
  })

  it('does not treat cloud targets as local filesystem authority', async () => {
    const project = {
      ...localProject('project-1', ''),
      environments: [{
        id: 'cloud-1', name: 'Production', scope: 'production', kind: 'cloud',
        path: 'provider-owned-target', entries: [],
      }],
    }
    await expect(authorizeProjectPathMutation(
      { envProjects: [] },
      { type: 'env-project.create', project },
      5,
      new ProjectPathCapabilityStore(),
    )).resolves.toMatchObject({ project })
  })
})

function localProject(id: string, path: string) {
  return {
    id,
    name: 'Project',
    path,
    entries: [],
    addToGitignore: true,
    environments: [{
      id: `${id}:local`,
      name: 'Local',
      scope: 'development',
      kind: 'local',
      path,
      entries: [],
      addToGitignore: true,
    }],
  }
}

async function temporaryFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'vaultage-project-path-'))
  temporaryFolders.push(folder)
  return folder
}
