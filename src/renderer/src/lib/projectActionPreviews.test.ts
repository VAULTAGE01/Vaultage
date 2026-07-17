import { describe, expect, it } from 'vitest'
import {
  clearEnvironmentMappingsConfirmation,
  deleteCloudEnvironmentConfirmation,
  disconnectEnvironmentTargetConfirmation,
  projectDeletionConfirmation,
  replaceEnvFileConfirmation,
  resetLocalEnvironmentConfirmation,
} from './projectActionPreviews'

describe('project and environment consequence previews', () => {
  it('distinguishes encrypted project metadata from data that remains outside the deletion', () => {
    const message = projectDeletionConfirmation({
      projectName: 'Storefront',
      environmentCount: 3,
      mappingCount: 12,
    })
    expect(message).toContain('removes 3 environments and 12 secret mappings')
    expect(message).toContain('Saved secrets, remote service values, project source files, and existing .env files will not be deleted.')
  })

  it('previews mapping removal while explicitly preserving targets and existing values', () => {
    const message = clearEnvironmentMappingsConfirmation('Staging', 1)
    expect(message).toContain('Clear 1 mapping')
    expect(message).toContain('target folder or provider remains connected')
    expect(message).toContain('existing local or remote environment values will not be deleted')
  })

  it('explains target disconnection separately for local and cloud environments', () => {
    const local = disconnectEnvironmentTargetConfirmation({
      environmentName: 'Local',
      kind: 'local',
      targetLabel: '/workspace/storefront',
      mappingCount: 4,
    })
    expect(local).toContain('Disconnect the folder')
    expect(local).toContain('4 mappings will remain in Vaultage')
    expect(local).toContain('existing .env file and project folder will not be changed')

    const cloud = disconnectEnvironmentTargetConfirmation({
      environmentName: 'Production',
      kind: 'cloud',
      targetLabel: 'Cloudflare / production',
      mappingCount: 2,
    })
    expect(cloud).toContain('Disconnect the provider target')
    expect(cloud).toContain('Remote service values will not be changed.')
  })

  it('describes reset and cloud-environment deletion without implying external deletion', () => {
    const local = resetLocalEnvironmentConfirmation({
      environmentName: 'Local',
      localPath: '/workspace/storefront',
      mappingCount: 5,
    })
    expect(local).toContain('disconnect /workspace/storefront and remove 5 mappings')
    expect(local).toContain('any existing .env file will remain on disk')

    const cloud = deleteCloudEnvironmentConfirmation({
      environmentName: 'Preview',
      providerName: 'Vercel',
      mappingCount: 7,
    })
    expect(cloud).toContain('7 mappings and connection to Vercel')
    expect(cloud).toContain('remote service values will not be deleted')
  })

  it('warns about plaintext overwrite and reports gitignore protection state', () => {
    const protectedMessage = replaceEnvFileConfirmation({
      localPath: '/workspace/storefront',
      valueCount: 8,
      addToGitignore: true,
    })
    expect(protectedMessage).toContain('8 selected values will be written in plaintext')
    expect(protectedMessage).toContain('current file contents will be overwritten')
    expect(protectedMessage).toContain('ensure .env is ignored by Git')

    const unprotectedMessage = replaceEnvFileConfirmation({
      localPath: '/workspace/storefront',
      valueCount: 1,
      addToGitignore: false,
    })
    expect(unprotectedMessage).toContain('1 selected value will be written')
    expect(unprotectedMessage).toContain('Automatic .gitignore protection is off')
    expect(unprotectedMessage).toContain('cannot be undone by Vaultage')
  })
})
