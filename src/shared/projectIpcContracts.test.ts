import { describe, expect, it } from 'vitest'
import { projectIpcContracts } from './projectIpcContracts'

describe('project IPC contracts', () => {
  it('bounds manual files before path capability checks', () => {
    expect(() => projectIpcContracts.scan.validate({
      path: '/tmp/project',
      manualFiles: Array.from({ length: 33 }, (_, index) => `/tmp/project/file-${index}`),
    })).toThrow('at most 32')
  })

  it('defaults plaintext replacement intent to false', () => {
    expect(projectIpcContracts.exportEnv.validate({
      projectId: 'project-1',
      environmentId: 'project-1:local',
    })).toMatchObject({ overwriteExisting: false })
    expect(() => projectIpcContracts.exportEnv.validate({
      environmentId: 'project-1:local',
    })).toThrow('project id')
    expect(() => projectIpcContracts.exportEnv.validate({
      projectId: 'project-1',
      environmentId: 'project-1:local',
      path: '/tmp/renderer-controlled',
    })).toThrow('Unexpected project export field: path')
    expect(() => projectIpcContracts.exportEnv.validate({
      projectId: 'project-1',
      environmentId: 'project-1:local',
      plaintextConfirmation: 'EXPORT PLAINTEXT',
    })).toThrow('Unexpected project export field: plaintextConfirmation')
  })

  it('binds native folder picks to an explicit purpose and optional Project', () => {
    expect(projectIpcContracts.pickFolder.validate({
      purpose: 'project-local-path', projectId: 'project-1',
    })).toEqual({ purpose: 'project-local-path', projectId: 'project-1' })
    expect(projectIpcContracts.pickFolder.validate({ purpose: 'scan-parent' }))
      .toEqual({ purpose: 'scan-parent', projectId: undefined })
    expect(() => projectIpcContracts.pickFolder.validate({
      purpose: 'scan-parent', projectId: 'project-1',
    })).toThrow('cannot target')
  })

  it('rejects missing and unsupported picker purposes before any handler work', () => {
    expect(() => projectIpcContracts.pickFolder.validate(undefined)).toThrow('must be an object')
    expect(() => projectIpcContracts.pickFolder.validate({ purpose: 'unsupported-purpose' }))
      .toThrow('Invalid project folder picker purpose')
  })

  it('accepts a bounded project identity for authoritative scan policy', () => {
    expect(projectIpcContracts.scan.validate({
      path: '/tmp/project',
      projectId: 'project-1',
    })).toEqual({ path: '/tmp/project', projectId: 'project-1', manualFiles: undefined })
    expect(() => projectIpcContracts.scan.validate({
      path: '/tmp/project', projectId: 'x'.repeat(241),
    })).toThrow('Invalid project id')
    expect(() => projectIpcContracts.scan.validate({
      path: '/tmp/project', replaceProjectId: 'project-active',
    })).toThrow('Unexpected project scan field')
  })
})
