import { describe, expect, it } from 'vitest'
import type { EnvProject } from '../types'
import {
  countSecretProjectMappings,
  secretDeletionConfirmation,
  secretEnvironmentRemovalConfirmation,
} from './secretActionPreviews'

const projects: EnvProject[] = [
  {
    id: 'project-storefront',
    name: 'Storefront',
    path: '/workspace/storefront',
    entries: [
      { secretId: 'secret-api', fieldKey: 'Development', envKey: 'API_KEY' },
    ],
    addToGitignore: true,
    environments: [
      {
        id: 'storefront-local',
        name: 'Local',
        scope: 'development',
        kind: 'local',
        path: '/workspace/storefront',
        entries: [{ secretId: 'secret-api', fieldKey: 'Development', envKey: 'API_KEY' }],
      },
      {
        id: 'storefront-production',
        name: 'Production',
        scope: 'production',
        kind: 'cloud',
        entries: [{ secretId: 'secret-api', fieldKey: 'Production', envKey: 'API_KEY' }],
      },
    ],
  },
  {
    id: 'project-worker',
    name: 'Worker',
    path: '/workspace/worker',
    entries: [{ secretId: 'secret-other', fieldKey: 'Value', envKey: 'OTHER' }],
    addToGitignore: true,
  },
]

describe('secret consequence previews', () => {
  it('counts logical environment mappings without double-counting mirrored legacy local entries', () => {
    expect(countSecretProjectMappings(projects, 'secret-api')).toBe(2)
    expect(countSecretProjectMappings(projects, 'secret-api', 'Development')).toBe(1)
    expect(countSecretProjectMappings(projects, 'secret-api', 'Production')).toBe(1)
    expect(countSecretProjectMappings(projects, 'missing')).toBe(0)
  })

  it('explains cascading local reference removal while preserving exported and remote data', () => {
    const message = secretDeletionConfirmation({
      secret: {
        name: 'Payments API',
        providerLink: {
          providerId: 'provider-stripe',
          remoteName: 'payments-api',
          createdInVaultage: false,
        },
      },
      projectMappingCount: 2,
    })
    expect(message).toContain('encrypted fields, notes, and metadata will be permanently removed')
    expect(message).toContain('2 project mappings will be removed automatically')
    expect(message).toContain('plaintext .env files, will remain unchanged')
    expect(message).toContain('remote service value will not be revoked or deleted')
    expect(message).toContain('cannot be undone')
  })

  it('warns that field-specific mappings become unresolved when an environment value is removed', () => {
    const message = secretEnvironmentRemovalConfirmation({
      secretName: 'Payments API',
      environmentLabel: 'Production',
      projectMappingCount: 1,
    })
    expect(message).toContain('encrypted field and its value will be permanently removed')
    expect(message).toContain('1 project mapping will remain but will need a replacement field')
    expect(message).toContain('existing exported files, and remote service data will remain unchanged')
  })
})
