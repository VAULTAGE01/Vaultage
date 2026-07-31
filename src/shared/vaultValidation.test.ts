import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_PROVIDER_TYPES,
  VAULT_VALIDATION_LIMITS,
  VaultValidationError,
  validateVaultImportPayload,
  validateVaultRoot,
} from './vaultValidation'
import {
  REDACTED_PROVIDER_CONFIG_VALUE,
  REDACTED_SECRET_VALUE,
} from './vaultRedaction'

describe('validateVaultRoot', () => {
  it('accepts a complete v2 vault and every supported provider type', () => {
    const vault = validVault()
    vault.providers = SUPPORTED_PROVIDER_TYPES.map((type, index) => ({
      id: `provider-${index}`,
      name: `Provider ${index}`,
      type,
      config: {},
      groupId: 'group-1',
    }))
    vault.root.secrets[0].providerLink = {
      providerId: 'provider-0',
      remoteName: 'REMOTE_KEY',
      createdInVaultage: false,
      status: 'active',
      statusUpdatedAt: NOW,
    }
    vault.root.secrets[0].browserExtensionAllowed = false
    vault.root.secrets[0].agentAvailable = false
    vault.root.secrets[0].revealAllowed = false
    vault.root.secrets[0].cliExportAllowed = false
    vault.envProjects[0].environments = [{
      id: 'environment-cloud',
      name: 'Production',
      scope: 'production',
      kind: 'cloud',
      entries: [{ secretId: 'secret-1', fieldKey: 'API Key', envKey: 'REMOTE_API_KEY' }],
      providerId: 'provider-0',
      syncRule: 'push',
    }]

    expect(() => validateVaultRoot(vault)).not.toThrow()
  })

  it('accepts legitimate legacy collection omissions and version 1', () => {
    expect(() => validateVaultRoot({
      version: 1,
      root: { id: 'root', name: 'Legacy vault' },
    })).not.toThrow()
  })

  it('unwraps and validates scoped export envelopes', () => {
    const vault = validVault()
    expect(validateVaultImportPayload({
      format: 'vaultage.export.v1',
      exportedAt: NOW,
      itemCount: 1,
      vault,
    })).toBe(vault)
  })

  it('rejects unsupported versions, provider types, and invalid dates', () => {
    const unsupportedVersion = validVault()
    unsupportedVersion.version = 99
    expectInvalid(unsupportedVersion, 'unsupported_version', '$.version')

    const unsupportedProvider = validVault()
    unsupportedProvider.providers[0].type = 'unknown-provider'
    expectInvalid(unsupportedProvider, 'enum', '$.providers[0].type')

    const invalidExpiry = validVault()
    invalidExpiry.root.secrets[0].expiresAt = '2025-02-29'
    expectInvalid(invalidExpiry, 'format', '$.root.secrets[0].expiresAt')

    const validDateExpiry = validVault()
    validDateExpiry.root.secrets[0].expiresAt = '2028-02-29'
    expect(() => validateVaultRoot(validDateExpiry)).not.toThrow()
  })

  it('rejects duplicate IDs and dangling item-order references', () => {
    const duplicateSecret = validVault()
    duplicateSecret.root.children = [{
      id: 'folder-child',
      name: 'Child',
      children: [],
      secrets: [{ ...duplicateSecret.root.secrets[0] }],
    }]
    expectInvalid(duplicateSecret, 'duplicate_id', '$.root.children[0].secrets[0].id')

    const danglingOrder = validVault()
    danglingOrder.root.itemOrder = [{ kind: 'secret', id: 'missing' }]
    expectInvalid(danglingOrder, 'dangling_reference', '$.root.itemOrder[0]')
  })

  it('rejects dangling secret, field, provider, group, and preference references', () => {
    const missingSecret = validVault()
    missingSecret.envProjects[0].entries[0].secretId = 'missing'
    expectInvalid(missingSecret, 'dangling_reference', '$.envProjects[0].entries[0].secretId')

    const missingField = validVault()
    missingField.envProjects[0].entries[0].fieldKey = 'Missing field'
    expectInvalid(missingField, 'dangling_reference', '$.envProjects[0].entries[0].fieldKey')

    const missingProvider = validVault()
    missingProvider.root.secrets[0].providerLink = {
      providerId: 'missing',
      remoteName: 'REMOTE_KEY',
      createdInVaultage: false,
    }
    expectInvalid(missingProvider, 'dangling_reference', '$.root.secrets[0].providerLink.providerId')

    const missingGroup = validVault()
    missingGroup.providers[0].groupId = 'missing'
    expectInvalid(missingGroup, 'dangling_reference', '$.providers[0].groupId')

    const missingPin = validVault()
    missingPin.preferences.localDashboardPinnedOrder = ['project:missing']
    expectInvalid(missingPin, 'dangling_reference', '$.preferences.localDashboardPinnedOrder[0]')
  })

  it('validates provider target metadata on fixed slots and rejects automatic sync directions', () => {
    const valid = validVault()
    valid.envProjects[0].environments = [{
      id: 'project-1:staging',
      name: 'Stg',
      scope: 'staging',
      kind: 'cloud',
      entries: [{ secretId: 'secret-1', fieldKey: 'API Key', envKey: 'API_KEY' }],
      providerId: 'provider-1',
      syncRule: 'manual',
      providerBinding: {
        kind: 'external-secret-target',
        target: 'project-1-staging',
      },
    }]
    expect(() => validateVaultRoot(valid)).not.toThrow()

    const automatic = structuredClone(valid)
    automatic.envProjects[0].environments[0].syncRule = 'push'
    expectInvalid(automatic, 'unsupported', '$.envProjects[0].environments[0].syncRule')

    const wrongSlot = structuredClone(valid)
    wrongSlot.envProjects[0].environments[0].id = 'project-1:production'
    expectInvalid(wrongSlot, 'relationship', '$.envProjects[0].environments[0].id')

    const malformed = structuredClone(valid)
    malformed.envProjects[0].environments[0].providerBinding = 'not-an-object'
    expectInvalid(malformed, 'type', '$.envProjects[0].environments[0].providerBinding')
  })

  it('allows renderer redaction placeholders but rejects unresolved persisted placeholders', () => {
    const rendererVault = validVault()
    rendererVault.root.secrets[0].fields[0].value = REDACTED_SECRET_VALUE
    rendererVault.providers[0].config.token = REDACTED_PROVIDER_CONFIG_VALUE
    expect(() => validateVaultRoot(rendererVault, { boundary: 'renderer' })).not.toThrow()
    expectInvalid(rendererVault, 'redacted_value', '$.providers[0].config.token')

    const rendererImage = validVault()
    rendererImage.root.secrets = [imageSecret(REDACTED_SECRET_VALUE, 'image-1')]
    rendererImage.root.itemOrder = [{ kind: 'secret', id: 'image-1' }]
    rendererImage.envProjects = []
    rendererImage.preferences.localDashboardPinnedOrder = []
    expect(() => validateVaultRoot(rendererImage, { boundary: 'renderer' })).not.toThrow()
    expectInvalid(rendererImage, 'redacted_value', '$.root.secrets[0].fields[0].value')
  })

  it('enforces bounded folder depth and field counts', () => {
    const tooDeep = validVault()
    tooDeep.root.secrets = []
    tooDeep.root.itemOrder = []
    tooDeep.envProjects = []
    let folder = tooDeep.root
    for (let depth = 0; depth <= VAULT_VALIDATION_LIMITS.maxFolderDepth; depth += 1) {
      const child = { id: `folder-${depth}`, name: 'Nested', children: [], secrets: [] as VaultSecretFixture[] }
      folder.children = [child]
      folder = child
    }
    expectInvalid(tooDeep, 'limit')

    const tooManyFields = validVault()
    tooManyFields.root.secrets[0].fields = Array.from(
      { length: VAULT_VALIDATION_LIMITS.maxFieldsPerSecret + 1 },
      (_, index) => ({ key: `Field ${index}`, value: '', sensitive: true }),
    )
    expectInvalid(tooManyFields, 'limit', '$.root.secrets[0].fields')
  })

  it('validates base64 and enforces the aggregate embedded-image budget', () => {
    const invalidBase64 = validVault()
    invalidBase64.root.secrets = [imageSecret('data:image/png;base64,not_base64!', 'image-1')]
    invalidBase64.root.itemOrder = [{ kind: 'secret', id: 'image-1' }]
    invalidBase64.envProjects = []
    expectInvalid(invalidBase64, 'image_format')

    const aggregate = validVault()
    const bytesPerImage = Math.floor(VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytesAggregate / 2) + 3
    const encoded = 'AAAA'.repeat(Math.ceil(bytesPerImage / 3))
    aggregate.root.secrets = [
      imageSecret(`data:image/png;base64,${encoded}`, 'image-1'),
      imageSecret(`data:image/webp;base64,${encoded}`, 'image-2'),
    ]
    aggregate.root.itemOrder = [
      { kind: 'secret', id: 'image-1' },
      { kind: 'secret', id: 'image-2' },
    ]
    aggregate.envProjects = []
    expectInvalid(aggregate, 'limit', '$.root.secrets[1].fields[0].value')
  })

  it('never includes rejected plaintext values in validation errors', () => {
    const vault = validVault()
    vault.providers[0].config.token = { plaintext: 'do-not-leak-this-token' }

    try {
      validateVaultRoot(vault)
      throw new Error('expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultValidationError)
      expect(String(error)).not.toContain('do-not-leak-this-token')
    }
  })
})

const NOW = '2026-07-11T12:00:00.000Z'

interface VaultSecretFixture {
  id: string
  name: string
  type: string
  fields: { key: string; value: unknown; sensitive: boolean }[]
  notes: string
  createdAt: string
  updatedAt: string
  expiresAt?: string
  providerLink?: Record<string, unknown>
  browserExtensionAllowed?: boolean
  agentAvailable?: boolean
  revealAllowed?: boolean
  cliExportAllowed?: boolean
}

function validVault() {
  return {
    version: 2,
    revision: 1,
    root: {
      id: 'root',
      name: 'Vault',
      children: [] as ReturnType<typeof validVault>['root']['children'],
      secrets: [{
        id: 'secret-1',
        name: 'API key',
        type: 'apiKey',
        fields: [{ key: 'API Key', value: 'plaintext-value', sensitive: true }],
        notes: '',
        createdAt: NOW,
        updatedAt: NOW,
      }] as VaultSecretFixture[],
      itemOrder: [{ kind: 'secret', id: 'secret-1' }],
    },
    providers: [{
      id: 'provider-1',
      name: 'Custom provider',
      type: 'custom',
      config: { baseUrl: 'https://example.test', token: 'provider-token' } as Record<string, unknown>,
      groupId: null as string | null,
    }],
    providerGroups: [{ id: 'group-1', name: 'Deploy', categoryId: 'deploy' }],
    envProjects: [{
      id: 'project-1',
      name: 'App',
      path: '/tmp/app',
      entries: [{ secretId: 'secret-1', fieldKey: 'API Key', envKey: 'API_KEY' }],
      addToGitignore: true,
      environments: [] as Record<string, unknown>[],
    }],
    preferences: {
      localDefaultFoldersCreated: true,
      localDashboardPinnedOrder: ['secret:secret-1', 'project:project-1', 'service:provider-1'],
    },
  }
}

function imageSecret(value: string, id: string): VaultSecretFixture {
  return {
    id,
    name: 'Image',
    type: 'image',
    fields: [{ key: '__image__', value, sensitive: true }],
    notes: '',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function expectInvalid(value: unknown, code: string, path?: string): void {
  try {
    validateVaultRoot(value)
    throw new Error('expected validation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(VaultValidationError)
    expect((error as VaultValidationError).code).toBe(code)
    if (path) expect((error as VaultValidationError).path).toBe(path)
  }
}
