import { describe, expect, it } from 'vitest'
import { vaultIpcContracts } from './vaultIpcContracts'

describe('vaultIpcContracts', () => {
  it('declares stable vault IPC channel names', () => {
    expect(vaultIpcContracts.mutate.channel).toBe('vault:mutate')
    expect(vaultIpcContracts.copySecretField.channel).toBe('vault:copy-secret-field')
    expect(vaultIpcContracts.revealSecretField.channel).toBe('vault:reveal-secret-field')
    expect(vaultIpcContracts.exportScope.channel).toBe('vault:export-scope')
    expect(vaultIpcContracts.saveImportTemplate.channel).toBe('vault:save-import-template')
    expect(vaultIpcContracts.beginEncryptedImport.channel).toBe('vault:begin-encrypted-import')
    expect(vaultIpcContracts.commitEncryptedImport.channel).toBe('vault:commit-encrypted-import')
    expect(vaultIpcContracts.cancelEncryptedImport.channel).toBe('vault:cancel-encrypted-import')
  })

  it('validates reveal payloads at the boundary', () => {
    expect(vaultIpcContracts.copySecretImageField.validate({
      secretId: 'secret-image',
      fieldKey: '__image__',
      confirmationPhrase: 'REVEAL SECRET',
    })).toEqual({
      secretId: 'secret-image',
      fieldKey: '__image__',
      fieldId: undefined,
      confirmationPhrase: 'REVEAL SECRET',
    })

    expect(vaultIpcContracts.copySecretField.validate({
      secretId: 'secret-1',
      fieldKey: 'API Key',
      fieldId: 'field-1',
      confirmationPhrase: 'REVEAL SECRET',
    })).toEqual({
      secretId: 'secret-1',
      fieldKey: 'API Key',
      fieldId: 'field-1',
      confirmationPhrase: 'REVEAL SECRET',
    })

    expect(vaultIpcContracts.revealSecretField.validate({
      secretId: 'secret-1',
      fieldKey: 'API Key',
      fieldId: 'field-1',
      confirmationPhrase: 'REVEAL SECRET',
      pin: '1234',
    })).toEqual({
      secretId: 'secret-1',
      fieldKey: 'API Key',
      fieldId: 'field-1',
      confirmationPhrase: 'REVEAL SECRET',
      pin: '1234',
    })

    expect(() => vaultIpcContracts.revealSecretField.validate({
      secretId: 'secret-1',
      fieldKey: 42,
    })).toThrow('field key must be a string')
  })

  it('keeps image-save and opaque encrypted-import payloads narrowly typed', () => {
    expect(() => vaultIpcContracts.saveSecretImageField.validate({
      secretId: 'secret-image',
      fieldKey: '__image__',
      dataUrl: 'data:image/png;base64,renderer-must-not-supply-this',
    })).toThrow('unsupported property dataUrl')

    expect(vaultIpcContracts.commitEncryptedImport.validate({
      token: 'opaque-token',
      selectionIds: ['selection-a'],
      destinationFolderId: 'folder-a',
      expectedRevision: 3,
    })).toEqual({
      token: 'opaque-token',
      selectionIds: ['selection-a'],
      destinationFolderId: 'folder-a',
      expectedRevision: 3,
    })
    expect(() => vaultIpcContracts.commitEncryptedImport.validate({
      token: 'opaque-token',
      selectionIds: ['selection-a', 'selection-a'],
      destinationFolderId: 'folder-a',
      expectedRevision: 3,
    })).toThrow('must be unique')
  })

  it('accepts only bounded semantic mutation commands with a positive revision', () => {
    expect(vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 7,
      command: { type: 'folder.rename', folderId: 'folder-1', name: 'Renamed' },
    })).toEqual({
      mutationId: "mutation-test-id",
      expectedRevision: 7,
      command: { type: 'folder.rename', folderId: 'folder-1', name: 'Renamed' },
    })

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 0,
      command: { type: 'folder.rename' },
    })).toThrow('revision must be a positive integer')
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: { type: 'vault.replace-entire-document' },
    })).toThrow('Unsupported vault mutation type')
  })

  it('validates every supported mutation as a discriminated command shape', () => {
    const secret = sampleSecret()
    const provider = sampleProvider()
    const project = sampleProject()
    const folder = sampleFolder()
    const commands = [
      { type: 'bootstrap.defaults', folders: [{ id: 'default-a', name: 'Personal' }] },
      { type: 'folder.create', parentId: 'root', folder: sampleFolder('folder-new') },
      { type: 'folder.rename', folderId: 'folder-a', name: 'Renamed' },
      { type: 'folder.delete', folderId: 'folder-a' },
      { type: 'folder.duplicate', folderId: 'folder-a' },
      {
        type: 'folder.move-item',
        item: { kind: 'secret', id: 'secret-a' },
        target: { folderId: 'folder-a', position: 'before', target: { kind: 'secret', id: 'secret-b' } },
      },
      { type: 'folder.sort', folderId: 'folder-a', key: 'updatedAt', direction: 'desc' },
      { type: 'folder.import', parentId: 'root', folder, selectedSecretIds: ['secret-a'] },
      { type: 'secret.create-many', folderId: 'folder-a', secrets: [secret] },
      {
        type: 'secret.create-many-and-map',
        folderId: 'folder-a',
        projectId: 'project-a',
        secrets: [secret],
        entries: [{ secretId: 'secret-a', fieldId: 'field-a', fieldKey: 'token', envKey: 'TOKEN' }],
      },
      { type: 'secret.update', folderId: 'folder-a', secret },
      {
        type: 'secret.provider-link.set',
        folderId: 'folder-a',
        secretId: 'secret-a',
        link: { providerId: 'provider-a', remoteName: 'token', status: 'active' },
      },
      { type: 'secret.delete', folderId: 'folder-a', secretId: 'secret-a' },
      { type: 'provider.create', provider, categoryId: 'code', categoryLabel: 'Code' },
      { type: 'provider.create', provider, categoryId: undefined, categoryLabel: undefined },
      { type: 'provider.update', provider },
      { type: 'provider.update-with-secret', provider, folderId: 'folder-a', secret },
      { type: 'provider.delete', providerId: 'provider-a' },
      { type: 'provider-group.create', group: { id: 'group-a', name: 'Group', categoryId: 'code' } },
      { type: 'provider-group.rename', groupId: 'group-a', name: 'Renamed group' },
      { type: 'provider-group.delete', groupId: 'group-a' },
      { type: 'provider.move', providerId: 'provider-a', groupId: null },
      { type: 'env-project.create', project },
      { type: 'env-project.update', project },
      { type: 'env-project.update-many', projects: [project] },
      { type: 'env-project.delete', projectId: 'project-a' },
      { type: 'preferences.patch', patch: { defaultAgentAvailable: true } },
    ]

    for (const command of commands) {
      expect(() => vaultIpcContracts.mutate.validate({
        mutationId: 'mutation-test-id',
        expectedRevision: 1,
        command,
      })).not.toThrow()
    }
  })

  it('accepts provider target metadata on a fixed project slot and rejects a forged slot identity', () => {
    const project = sampleProject()
    project.environments = [{
      id: 'project-a:staging',
      name: 'Stg',
      scope: 'staging',
      kind: 'cloud',
      entries: [{ secretId: 'secret-a', fieldKey: 'token', envKey: 'TOKEN' }],
      providerId: 'provider-a',
      syncRule: 'manual',
      providerBinding: {
        kind: 'external-secret-target',
        target: 'project-a-staging',
      },
    }]
    const payload = {
      mutationId: 'mutation-test-id',
      expectedRevision: 1,
      command: { type: 'env-project.update', project },
    }

    expect(() => vaultIpcContracts.mutate.validate(payload)).not.toThrow()

    const forged = structuredClone(payload)
    const forgedProject = forged.command.project as Record<string, unknown>
    const forgedEnvironments = forgedProject.environments as Array<Record<string, unknown>>
    forgedEnvironments[0].id = 'project-a:production'
    expect(() => vaultIpcContracts.mutate.validate(forged)).toThrow(
      'provider binding must use the fixed project environment id and scope',
    )
  })

  it('rejects missing, excess, and malformed command properties before mutation dispatch', () => {
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: { type: 'folder.rename', folderId: 'folder-a' },
    })).toThrow('missing required property name')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: { type: 'folder.rename', folderId: 'folder-a', name: 'A', forged: true },
    })).toThrow('unsupported property forged')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'secret.update',
        folderId: 'folder-a',
        secret: { ...sampleSecret(), hiddenMutation: 'surprise' },
      },
    })).toThrow('unsupported property hiddenMutation')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: { type: 'preferences.patch', patch: { quickRevealPinEnabled: false } },
    })).toThrow('unsupported property quickRevealPinEnabled')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'preferences.patch',
        patch: { paidBetaOnboarding: {} },
      },
    })).toThrow('unsupported property paidBetaOnboarding')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: { type: 'folder.delete', folderId: 'folder-a' },
      unexpected: true,
    })).toThrow('unsupported property unexpected')
  })

  it('requires complete relative move coordinates', () => {
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'folder.move-item',
        item: { kind: 'secret', id: 'secret-a' },
        target: { folderId: 'folder-a', position: 'before' },
      },
    })).toThrow('target is required for relative moves')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'folder.move-item',
        item: { kind: 'secret', id: 'secret-a' },
        target: { folderId: 'folder-a', position: 'inside', target: { kind: 'secret', id: 'secret-b' } },
      },
    })).toThrow('must not include a relative target')

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'provider.move',
        providerId: 'provider-a',
        groupId: null,
        targetProviderId: 'provider-b',
      },
    })).toThrow('target and position must be supplied together')
  })

  it('bounds bulk arrays, recursive imports, and total encoded bytes', () => {
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'bootstrap.defaults',
        folders: Array.from({ length: 65 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}` })),
      },
    })).toThrow('contains too many items')

    let folder: Record<string, unknown> = sampleFolder('leaf')
    for (let depth = 0; depth < 34; depth += 1) {
      folder = { ...sampleFolder(`folder-${depth}`), children: [folder] }
    }
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: { type: 'folder.import', parentId: 'root', folder },
    })).toThrow(/too deeply nested/)

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: "mutation-test-id",
      expectedRevision: 1,
      command: {
        type: 'folder.rename',
        folderId: 'folder-a',
        name: 'x'.repeat(9 * 1024 * 1024),
      },
    })).toThrow('vault mutation payload is too large')
  })

  it('normalizes optional JSON export payloads', () => {
    expect(vaultIpcContracts.exportJson.validate(undefined)).toEqual({})
    expect(vaultIpcContracts.exportJson.validate({
      plaintextConfirmation: 'EXPORT PLAINTEXT',
    })).toEqual({
      plaintextConfirmation: 'EXPORT PLAINTEXT',
    })
  })

  it('validates scoped export payloads', () => {
    expect(vaultIpcContracts.exportScope.validate({
      scope: { kind: 'folder', id: 'folder-api' },
      format: 'encrypted',
      encryptionPassword: 'correct horse battery staple',
    })).toEqual({
      scope: { kind: 'folder', id: 'folder-api' },
      format: 'encrypted',
      encryptionPassword: 'correct horse battery staple',
      plaintextConfirmation: undefined,
    })

    expect(() => vaultIpcContracts.exportScope.validate({
      scope: { kind: 'folder', id: '' },
      format: 'json',
    })).toThrow('Invalid export folder id')
  })
})

function sampleSecret(): Record<string, unknown> {
  return {
    id: 'secret-a',
    name: 'API token',
    type: 'apiKey',
    fields: [{ id: 'field-a', key: 'token', value: 'secret-value', sensitive: true }],
    notes: '',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    usageCount: 0,
    browserExtensionAllowed: false,
    agentAvailable: false,
    revealAllowed: false,
    cliExportAllowed: false,
    providerLink: {
      providerId: 'provider-a',
      remoteName: 'API token',
      createdInVaultage: false,
      status: 'active',
    },
  }
}

function sampleProvider(): Record<string, unknown> {
  return {
    id: 'provider-a',
    name: 'Provider',
    type: 'github',
    config: { token: 'provider-token' },
    connectionStatus: 'configured',
    groupId: null,
  }
}

function sampleProject(): Record<string, unknown> {
  return {
    id: 'project-a',
    name: 'Project',
    path: '/tmp/project',
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
  }
}

function sampleFolder(id = 'folder-a'): Record<string, unknown> {
  return { id, name: 'Folder', children: [], secrets: [], itemOrder: [] }
}
