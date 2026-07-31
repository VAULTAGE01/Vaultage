import { describe, expect, it } from 'vitest'
import {
  REDACTED_PROVIDER_CONFIG_VALUE,
  REDACTED_SECRET_VALUE,
} from '../shared/vaultRedaction'
import { validateVaultRoot } from '../shared/vaultValidation'
import { applyVaultMutationCommand } from './vaultCommandMutations'
import { redactVaultForRenderer } from './vaultRedaction'

describe('applyVaultMutationCommand', () => {
  it('updates one secret without accepting renderer-forged usage or redacted values', () => {
    const current = sampleVault()
    const redacted = redactVaultForRenderer(current) as any
    const incoming = structuredClone(redacted.root.secrets[0])
    incoming.name = 'Renamed'
    incoming.fields[0].value = REDACTED_SECRET_VALUE
    incoming.usageCount = 999
    incoming.lastUsedAt = '2099-01-01T00:00:00.000Z'

    const result = applyVaultMutationCommand(current, {
      type: 'secret.update',
      folderId: 'root',
      secret: incoming,
    }, { now: () => '2026-07-11T12:00:00.000Z' })

    const secret = (result.vault as any).root.secrets[0]
    expect(secret).toMatchObject({
      name: 'Renamed',
      usageCount: 2,
      lastUsedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
    })
    expect(secret.fields[0].value).toBe('secret-value')
    expect(() => validateVaultRoot(result.vault)).not.toThrow()
  })

  it('deletes folders and secrets with project and pin cascades', () => {
    const current = sampleVault()
    current.root.children[0].secrets.push({
      ...structuredClone(current.root.secrets[0]),
      id: 'secret-child',
      name: 'Child secret',
    })
    current.root.children[0].itemOrder = [{ kind: 'secret', id: 'secret-child' }]
    current.envProjects[0].entries.push({ secretId: 'secret-child', fieldKey: 'token', envKey: 'CHILD_TOKEN' })
    current.preferences.localDashboardPinnedOrder.push('secret:secret-child')

    const result = applyVaultMutationCommand(current, {
      type: 'folder.delete',
      folderId: 'folder-a',
    })
    const vault = result.vault as any

    expect(vault.root.children).toEqual([])
    expect(vault.envProjects[0].entries).toMatchObject([
      { secretId: 'secret-a', fieldKey: 'token', envKey: 'TOKEN' },
    ])
    expect(vault.preferences.localDashboardPinnedOrder).not.toContain('secret:secret-child')
    expect(() => validateVaultRoot(vault)).not.toThrow()
  })

  it('persists explicit project activation and cleans it on project deletion', () => {
    const current = sampleVault()
    current.envProjects.push({
      id: 'project-b', name: 'Project B', path: '/tmp/project-b', entries: [], addToGitignore: true,
    })
    current.preferences.activeEnvProjectIds = ['project-a']

    const activated = applyVaultMutationCommand(current, {
      type: 'env-project.activate', projectId: 'project-b', replaceProjectId: 'project-a',
    }).vault as any
    expect(activated.preferences.activeEnvProjectIds).toEqual(['project-b'])
    expect(activated.envProjects).toHaveLength(2)

    const deleted = applyVaultMutationCommand(activated, {
      type: 'env-project.delete', projectId: 'project-b',
    }).vault as any
    expect(deleted.preferences.activeEnvProjectIds).toEqual([])
    expect(deleted.envProjects.map((project: any) => project.id)).toEqual(['project-a'])
    expect(() => validateVaultRoot(deleted)).not.toThrow()
  })

  it('atomically creates a replacement Project without deleting the replaced definition', () => {
    const current = sampleVault()
    current.envProjects.push({
      id: 'project-b', name: 'Project B', path: '/tmp/project-b', entries: [], addToGitignore: true,
    })
    current.preferences.activeEnvProjectIds = ['project-a']
    const created = applyVaultMutationCommand(current, {
      type: 'env-project.create',
      project: { id: 'project-c', name: 'Project C', path: '/tmp/project-c', entries: [], addToGitignore: true },
      replaceProjectId: 'project-a',
      activeProjectIds: ['project-c'],
    }).vault as any
    expect(created.envProjects.map((project: any) => project.id)).toEqual(['project-a', 'project-b', 'project-c'])
    expect(created.preferences.activeEnvProjectIds).toEqual(['project-c'])
    expect(() => validateVaultRoot(created)).not.toThrow()
  })

  it('creates, moves, sorts, duplicates, and imports folder content in main', () => {
    let nextId = 0
    const options = {
      randomId: () => `generated-${++nextId}`,
      now: () => '2026-07-11T12:00:00.000Z',
    }
    let vault: any = applyVaultMutationCommand(sampleVault(), {
      type: 'folder.create',
      parentId: 'root',
      folder: { id: 'folder-b', name: 'B' },
    }, options).vault
    vault = applyVaultMutationCommand(vault, {
      type: 'folder.move-item',
      item: { kind: 'secret', id: 'secret-a' },
      target: { folderId: 'folder-b', position: 'inside' },
    }, options).vault
    vault = applyVaultMutationCommand(vault, {
      type: 'folder.sort',
      folderId: 'root',
      key: 'title',
      direction: 'desc',
    }, options).vault

    const duplicate = applyVaultMutationCommand(vault, {
      type: 'folder.duplicate',
      folderId: 'folder-b',
    }, options)
    vault = duplicate.vault
    expect(duplicate.result).toMatchObject({
      folderId: 'generated-2',
      firstSecretId: 'generated-1',
      secretCount: 1,
    })

    const source = structuredClone((vault as any).root.children.find((folder: any) => folder.id === 'folder-b'))
    const imported = applyVaultMutationCommand(vault, {
      type: 'folder.import',
      parentId: 'root',
      folder: source,
      selectedSecretIds: ['secret-a'],
    }, options)
    expect(imported.result).toMatchObject({ secretCount: 1, firstSecretId: 'generated-3' })
    expect(() => validateVaultRoot(imported.vault)).not.toThrow()
  })

  it('creates and maps secrets atomically against the latest project', () => {
    const current = sampleVault()
    const created = {
      ...structuredClone(current.root.secrets[0]),
      id: 'secret-new',
      name: 'New',
      fields: [{ key: 'value', value: 'new-value', sensitive: true }],
    }
    const result = applyVaultMutationCommand(current, {
      type: 'secret.create-many-and-map',
      folderId: 'folder-a',
      projectId: 'project-a',
      secrets: [created],
      entries: [{ secretId: 'secret-new', fieldKey: 'value', envKey: 'TOKEN' }],
    })
    const vault = result.vault as any

    expect(vault.root.children[0].secrets.map((secret: any) => secret.id)).toEqual(['secret-new'])
    expect(vault.envProjects[0].entries).toMatchObject([
      { secretId: 'secret-new', fieldKey: 'value', envKey: 'TOKEN' },
    ])
    expect(() => validateVaultRoot(vault)).not.toThrow()
  })

  it('restores redacted provider config and cascades provider deletion', () => {
    let vault: any = sampleVault()
    const incoming = structuredClone(vault.providers[0])
    incoming.name = 'Renamed provider'
    incoming.config.token = REDACTED_PROVIDER_CONFIG_VALUE
    vault = applyVaultMutationCommand(vault, {
      type: 'provider.update',
      provider: incoming,
    }).vault
    expect(vault.providers[0].config.token).toBe('provider-token')

    vault.envProjects[0].environments[0] = {
      ...vault.envProjects[0].environments[0],
      id: 'project-a:staging',
      name: 'Stg',
      scope: 'staging',
      syncRule: 'manual',
      providerBinding: {
        kind: 'external-secret-target',
        target: 'project-a-staging',
      },
    }

    vault = applyVaultMutationCommand(vault, {
      type: 'provider.delete',
      providerId: 'provider-a',
    }).vault
    expect(vault.providers).toEqual([])
    expect(vault.root.secrets[0].providerLink).toBeUndefined()
    expect(vault.envProjects[0].environments[0]).toMatchObject({ syncRule: 'manual' })
    expect(vault.envProjects[0].environments[0].providerId).toBeUndefined()
    expect(vault.envProjects[0].environments[0].providerBinding).toBeUndefined()
    expect(vault.preferences.localDashboardPinnedOrder).not.toContain('service:provider-a')
    expect(() => validateVaultRoot(vault)).not.toThrow()
  })

  it('auto-files new providers into a category group without replacing existing groups', () => {
    const result = applyVaultMutationCommand(sampleVault(), {
      type: 'provider.create',
      provider: {
        id: 'provider-new',
        name: 'GitHub',
        type: 'github',
        config: { token: 'new-token' },
      },
      categoryId: 'code',
      categoryLabel: 'Code',
    }, { randomId: () => 'group-code' })
    const vault = result.vault as any

    expect(vault.providerGroups).toEqual([
      { id: 'group-a', name: 'Existing' },
      { id: 'group-code', name: 'Code', categoryId: 'code' },
    ])
    expect(vault.providers.find((provider: any) => provider.id === 'provider-new').groupId).toBe('group-code')
    expect(() => validateVaultRoot(vault)).not.toThrow()
  })

  it('keeps quick-reveal credentials main-owned during preference patches', () => {
    const current = sampleVault()
    const result = applyVaultMutationCommand(current, {
      type: 'preferences.patch',
      patch: {
        defaultAgentAvailable: true,
        quickRevealPinEnabled: false,
        quickRevealPin: null,
      },
    })
    const preferences = (result.vault as any).preferences

    expect(preferences.defaultAgentAvailable).toBe(true)
    expect(preferences.quickRevealPinEnabled).toBe(true)
    expect(preferences.quickRevealPin).toEqual(current.preferences.quickRevealPin)
  })

  it('rejects stale targets and entity-id collisions rather than silently replacing data', () => {
    const current = sampleVault()
    expect(() => applyVaultMutationCommand(current, {
      type: 'folder.rename',
      folderId: 'missing',
      name: 'Nope',
    })).toThrow('Folder no longer exists')
    expect(() => applyVaultMutationCommand(current, {
      type: 'folder.create',
      parentId: 'root',
      folder: { id: 'secret-a', name: 'Collision' },
    })).toThrow('Entity id already exists')
    expect(() => applyVaultMutationCommand(current, {
      type: 'folder.move-item',
      item: { kind: 'secret', id: 'secret-a' },
      target: {
        folderId: 'folder-a',
        position: 'before',
        target: { kind: 'secret', id: 'missing' },
      },
    })).toThrow('target no longer exists')
    expect(() => applyVaultMutationCommand(current, {
      type: 'provider.move',
      providerId: 'provider-a',
      groupId: null,
      targetProviderId: 'missing',
      position: 'before',
    })).toThrow('Target provider no longer exists')
  })

  it('cascades field renames and removals by stable identity', () => {
    let current = sampleVault()
    const redacted = redactVaultForRenderer(current) as any
    const incoming = redacted.root.secrets[0]
    incoming.fields[0].key = 'renamed-token'

    current = applyVaultMutationCommand(current, {
      type: 'secret.update',
      folderId: 'root',
      secret: incoming,
    }).vault as any

    expect(current.envProjects[0].entries[0]).toMatchObject({
      fieldId: incoming.fields[0].id,
      fieldKey: 'renamed-token',
    })
    expect(current.envProjects[0].environments[0].entries[0]).toMatchObject({
      fieldId: incoming.fields[0].id,
      fieldKey: 'renamed-token',
    })

    const withoutField = (redactVaultForRenderer(current) as any).root.secrets[0]
    withoutField.fields = []
    current = applyVaultMutationCommand(current, {
      type: 'secret.update',
      folderId: 'root',
      secret: withoutField,
    }).vault as any
    expect(current.envProjects[0].entries).toEqual([])
    expect(current.envProjects[0].environments[0].entries).toEqual([])
    expect(() => validateVaultRoot(current)).not.toThrow()
  })

  it('detaches remote identity and usage history from duplicate and imported records', () => {
    const current = sampleVault()
    current.root.children[0].secrets.push(structuredClone(current.root.secrets[0]))
    current.root.children[0].secrets[0].id = 'secret-in-folder'
    current.root.children[0].itemOrder = [{ kind: 'secret', id: 'secret-in-folder' }]
    const duplicate = applyVaultMutationCommand(current, {
      type: 'folder.duplicate',
      folderId: 'folder-a',
    }, {
      randomId: sequenceIds(),
      now: () => '2026-07-11T12:00:00.000Z',
    }).vault as any
    const duplicatedSecret = duplicate.root.children.find((folder: any) => folder.name === 'A copy').secrets[0]
    expect(duplicatedSecret.providerLink).toBeUndefined()
    expect(duplicatedSecret).toMatchObject({
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
    })
    expect(duplicatedSecret.usageCount).toBeUndefined()
    expect(duplicatedSecret.lastUsedAt).toBeUndefined()
    // Add a linked secret to a portable source so the import cannot smuggle a
    // reference to a configured provider in the destination vault.
    const source = structuredClone(current.root)
    const imported = applyVaultMutationCommand(duplicate, {
      type: 'folder.import',
      parentId: 'root',
      folder: source,
      selectedSecretIds: ['secret-a'],
    }, { randomId: sequenceIds('import') }).vault as any
    const importedFolder = imported.root.children.at(-1)
    expect(importedFolder.secrets[0].providerLink).toBeUndefined()
    expect(() => validateVaultRoot(imported)).not.toThrow()
  })

  it('rejects duplicate entity ids within one create batch', () => {
    const current = sampleVault()
    const draft = structuredClone(current.root.secrets[0])
    draft.id = 'new-secret'
    expect(() => applyVaultMutationCommand(current, {
      type: 'secret.create-many',
      folderId: 'root',
      secrets: [draft, structuredClone(draft)],
    })).toThrow('Entity id already exists')
  })

  it('rejects duplicate project targets in an atomic update batch', () => {
    const current = sampleVault()
    const project = structuredClone(current.envProjects[0])
    expect(() => applyVaultMutationCommand(current, {
      type: 'env-project.update-many',
      projects: [project, { ...project, name: 'Silent winner' }],
    })).toThrow('Duplicate environment project id')
  })

  it('keeps remote provider lifecycle main-owned during generic edits', () => {
    const current = sampleVault()
    const incoming = (redactVaultForRenderer(current) as any).root.secrets[0]
    incoming.name = 'Safe rename'
    incoming.providerLink = {
      providerId: 'provider-a',
      remoteName: 'forged',
      createdInVaultage: false,
      remoteId: 'attacker-id',
      scopes: ['admin'],
      lastVerifiedAt: '2099-01-01T00:00:00.000Z',
    }
    const updated = applyVaultMutationCommand(current, {
      type: 'secret.update',
      folderId: 'root',
      secret: incoming,
    }).vault as any
    expect(updated.root.secrets[0].name).toBe('Safe rename')
    expect(updated.root.secrets[0].providerLink).toEqual(current.root.secrets[0].providerLink)
  })

  it('changes manual provider links through a constrained main-owned command', () => {
    const current = sampleVault()
    current.root.secrets[0].providerLink = {
      ...current.root.secrets[0].providerLink,
      createdInVaultage: true,
      remoteId: 'remote-1',
      scopes: ['read'],
      lastVerifiedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    }
    const linked = applyVaultMutationCommand(current, {
      type: 'secret.provider-link.set',
      folderId: 'root',
      secretId: 'secret-a',
      link: { providerId: 'provider-a', remoteName: 'renamed', status: 'missing' },
    }, { now: () => '2026-07-11T12:00:00.000Z' }).vault as any
    expect(linked.root.secrets[0].providerLink).toMatchObject({
      providerId: 'provider-a',
      remoteName: 'renamed',
      createdInVaultage: true,
      remoteId: 'remote-1',
      scopes: ['read'],
      lastVerifiedAt: '2026-01-01T00:00:00.000Z',
      status: 'missing',
      statusUpdatedAt: '2026-07-11T12:00:00.000Z',
    })
    const unlinked = applyVaultMutationCommand(linked, {
      type: 'secret.provider-link.set',
      folderId: 'root',
      secretId: 'secret-a',
      link: null,
    }).vault as any
    expect(unlinked.root.secrets[0].providerLink).toBeUndefined()
  })
})

function sequenceIds(prefix = 'generated'): () => string {
  let next = 0
  return () => `${prefix}-${++next}`
}

function sampleVault(): any {
  return {
    version: 2,
    revision: 4,
    root: {
      id: 'root',
      name: 'Vault',
      children: [{
        id: 'folder-a',
        name: 'A',
        children: [],
        secrets: [],
        itemOrder: [],
      }],
      secrets: [{
        id: 'secret-a',
        name: 'Secret A',
        type: 'apiKey',
        fields: [{ key: 'token', value: 'secret-value', sensitive: true }],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        usageCount: 2,
        lastUsedAt: '2026-01-02T00:00:00.000Z',
        providerLink: {
          providerId: 'provider-a',
          remoteName: 'token',
          createdInVaultage: true,
        },
      }],
      itemOrder: [
        { kind: 'folder', id: 'folder-a' },
        { kind: 'secret', id: 'secret-a' },
      ],
    },
    providers: [{
      id: 'provider-a',
      name: 'Provider A',
      type: 'custom',
      config: { token: 'provider-token', baseUrl: 'https://api.example.com' },
      groupId: 'group-a',
    }],
    providerGroups: [{ id: 'group-a', name: 'Existing' }],
    envProjects: [{
      id: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      entries: [{ secretId: 'secret-a', fieldKey: 'token', envKey: 'TOKEN' }],
      addToGitignore: true,
      environments: [{
        id: 'environment-a',
        name: 'Production',
        scope: 'production',
        kind: 'cloud',
        entries: [{ secretId: 'secret-a', fieldKey: 'token', envKey: 'TOKEN' }],
        providerId: 'provider-a',
        syncRule: 'push',
      }],
    }],
    preferences: {
      quickRevealPinEnabled: true,
      quickRevealPin: {
        version: 1,
        scrypt: { N: 131072, r: 8, p: 1, keylen: 32, salt: 'aa'.repeat(16) },
        verifier: 'bb'.repeat(16),
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      localDashboardPinnedOrder: ['secret:secret-a', 'project:project-a', 'service:provider-a'],
    },
  }
}
