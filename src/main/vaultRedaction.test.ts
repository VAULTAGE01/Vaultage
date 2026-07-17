import { describe, expect, it } from 'vitest'
import { REDACTED_PROVIDER_CONFIG_VALUE, REDACTED_SECRET_VALUE } from '../shared/vaultRedaction'
import {
  mergeRedactedProviderValues,
  mergeRedactedSecretValues,
  redactVaultForRenderer,
} from './vaultRedaction'

const vault = {
  version: 2,
  revision: 7,
  root: {
    id: 'root',
    name: 'Root',
    secrets: [{
      id: 'secret-1',
      name: 'API',
      fields: [
        { key: 'Service', value: 'Example', sensitive: false },
        { key: 'Token', value: 'real-token', sensitive: true },
        { key: 'Token', value: 'second-token', sensitive: true },
        { key: 'Empty', value: '', sensitive: true },
      ],
    }],
    children: [{
      id: 'child',
      name: 'Child',
      secrets: [{
        id: 'secret-2',
        name: 'Nested',
        fields: [{ key: 'Password', value: 'nested-password', sensitive: true }],
      }],
      children: [],
    }],
  },
  providers: [{
    id: 'provider-1',
    name: 'Provider',
    config: { token: 'provider-token', accountId: 'account-123' },
  }],
  preferences: {
    quickRevealPin: {
      version: 1,
      scrypt: { N: 131072, r: 8, p: 1, keylen: 32, salt: '00' },
      verifier: 'abcdef',
      updatedAt: '2026-06-02T12:00:00.000Z',
    },
  },
}

type RedactedVault = Omit<typeof vault, 'preferences'> & {
  preferences: Omit<typeof vault.preferences, 'quickRevealPin'> & {
    quickRevealPin?: undefined
    quickRevealPinEnabled?: boolean
  }
}

describe('vault redaction', () => {
  it('forces legacy secure-note content and notes through the sensitive-value boundary', () => {
    const secureNoteVault = {
      version: 2,
      revision: 1,
      root: {
        id: 'root',
        name: 'Root',
        children: [],
        secrets: [{
          id: 'note-1',
          name: 'Recovery notes',
          type: 'secureNote',
          notes: 'legacy note metadata',
          fields: [{ key: 'Content', value: 'private recovery text', sensitive: false }],
        }],
      },
      providers: [],
    }

    const redacted = redactVaultForRenderer(secureNoteVault) as any
    expect(redacted.root.secrets[0].notes).toBe(REDACTED_SECRET_VALUE)
    expect(redacted.root.secrets[0].fields[0]).toMatchObject({
      key: 'Content',
      value: REDACTED_SECRET_VALUE,
      sensitive: true,
    })

    const merged = mergeRedactedSecretValues(
      redacted.root.secrets[0],
      secureNoteVault.root.secrets[0],
    ) as any
    expect(merged.notes).toBe('legacy note metadata')
    expect(merged.fields[0]).toMatchObject({
      key: 'Content',
      value: 'private recovery text',
      sensitive: true,
    })
  })

  it.each(['password', 'custom', 'image'])('restores hidden notes while converting a secure note to %s', (type) => {
    const current = {
      id: 'note-1',
      name: 'Recovery note',
      type: 'secureNote',
      notes: 'main-owned hidden note',
      fields: [{ id: 'content', key: 'Content', value: 'hidden content', sensitive: true }],
    }
    const incoming = (redactVaultForRenderer({
      version: 2,
      root: { id: 'root', name: 'Root', children: [], secrets: [current] },
      providers: [],
    }) as any).root.secrets[0]
    incoming.type = type
    incoming.fields[0].value = 'replacement'

    const merged = mergeRedactedSecretValues(incoming, current) as any
    expect(merged.notes).toBe('main-owned hidden note')
    expect(merged.notes).not.toBe(REDACTED_SECRET_VALUE)
  })

  it('redacts sensitive field values and provider credentials without changing non-sensitive values', () => {
    const redacted = redactVaultForRenderer(vault) as RedactedVault

    expect(redacted.root.secrets[0].fields).toMatchObject([
      { key: 'Service', value: 'Example', sensitive: false },
      { key: 'Token', value: REDACTED_SECRET_VALUE, sensitive: true },
      { key: 'Token', value: REDACTED_SECRET_VALUE, sensitive: true },
      { key: 'Empty', value: '', sensitive: true },
    ])
    expect(redacted.root.children[0].secrets[0].fields[0].value).toBe(REDACTED_SECRET_VALUE)
    expect(redacted.providers[0].config.token).toBe(REDACTED_PROVIDER_CONFIG_VALUE)
    expect(redacted.providers[0].config.accountId).toBe('account-123')
    expect(redacted.preferences.quickRevealPin).toBeUndefined()
    expect(redacted.preferences.quickRevealPinEnabled).toBe(true)
    expect(vault.root.secrets[0].fields[1].value).toBe('real-token')
  })

  it('does not expose main-owned usage idempotency metadata to renderers', () => {
    const redacted = redactVaultForRenderer({
      ...vault,
      _vaultage: {
        recentUsageBatches: [{ id: 'batch-id', revision: 8 }],
      },
    }) as Record<string, unknown>

    expect(redacted._vaultage).toBeUndefined()
  })

  it('redacts every provider field the setup UI classifies as sensitive', () => {
    const redacted = redactVaultForRenderer({
      version: 2,
      root: { id: 'root', name: 'Vault', children: [], secrets: [] },
      providers: [{
        id: 'provider-sensitive',
        name: 'Sensitive provider',
        config: {
          token: 'token-value',
          accessKeyId: 'access-key-id',
          secretAccessKey: 'secret-access-key',
          sessionToken: 'session-token',
          adminKey: 'admin-key',
          accountSid: 'account-sid',
          authToken: 'auth-token',
          apiKeySid: 'api-key-sid',
          apiKeySecret: 'api-key-secret',
          headerValue: 'header-value',
          projectId: 'visible-project-id',
        },
      }],
      envProjects: [],
    }) as any

    for (const key of [
      'token', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'adminKey',
      'accountSid', 'authToken', 'apiKeySid', 'apiKeySecret', 'headerValue',
    ]) {
      expect(redacted.providers[0].config[key]).toBe(REDACTED_PROVIDER_CONFIG_VALUE)
    }
    expect(redacted.providers[0].config.projectId).toBe('visible-project-id')
  })

  it('preserves current values when redacted entities are updated', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].name = 'Renamed API'
    incoming.root.secrets[0].fields[0].value = 'Example, Inc.'

    const mergedSecret = mergeRedactedSecretValues(
      incoming.root.secrets[0],
      vault.root.secrets[0],
    ) as typeof vault.root.secrets[0]
    const mergedProvider = mergeRedactedProviderValues(
      incoming.providers[0],
      vault.providers[0],
    ) as typeof vault.providers[0]

    expect(mergedSecret.name).toBe('Renamed API')
    expect(mergedSecret.fields).toMatchObject([
      { key: 'Service', value: 'Example, Inc.', sensitive: false },
      { key: 'Token', value: 'real-token', sensitive: true },
      { key: 'Token', value: 'second-token', sensitive: true },
      { key: 'Empty', value: '', sensitive: true },
    ])
    expect(mergedProvider.config.token).toBe('provider-token')
  })

  it('allows a renderer payload to replace a provider credential intentionally', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.providers[0].config.token = 'new-provider-token'

    const merged = mergeRedactedProviderValues(incoming.providers[0], vault.providers[0]) as typeof vault.providers[0]

    expect(merged.config.token).toBe('new-provider-token')
  })

  it('allows a renderer payload to replace a sensitive value intentionally', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].fields[1].value = 'rotated-token'

    const merged = mergeRedactedSecretValues(incoming.root.secrets[0], vault.root.secrets[0]) as typeof vault.root.secrets[0]

    expect(merged.fields[1].value).toBe('rotated-token')
    expect(merged.fields[2].value).toBe('second-token')
  })

  it('preserves a redacted value when the field label is renamed', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].fields[1].key = 'Renamed Token'

    const merged = mergeRedactedSecretValues(incoming.root.secrets[0], vault.root.secrets[0]) as typeof vault.root.secrets[0]

    expect(merged.fields[1]).toMatchObject({
      key: 'Renamed Token',
      value: 'real-token',
      sensitive: true,
    })
  })

  it('rejects stale redaction placeholders that no longer match a current field', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].id = 'new-secret-id'

    expect(() => mergeRedactedSecretValues(incoming.root.secrets[0], vault.root.secrets[0]))
      .toThrow('Redacted secret field cannot be saved without a current value')
  })

  it('uses stable field identity instead of position or a duplicate label', () => {
    const incoming = redactVaultForRenderer(vault) as any
    const secondToken = incoming.root.secrets[0].fields[2]
    incoming.root.secrets[0].fields = [{ ...secondToken, key: 'Only token left' }]

    const merged = mergeRedactedSecretValues(
      incoming.root.secrets[0],
      vault.root.secrets[0],
    ) as any

    expect(merged.fields).toHaveLength(1)
    expect(merged.fields[0]).toMatchObject({
      id: secondToken.id,
      key: 'Only token left',
      value: 'second-token',
    })
  })

  it('rejects a redacted placeholder whose stable field identity is missing', () => {
    const incoming = redactVaultForRenderer(vault) as any
    delete incoming.root.secrets[0].fields[1].id

    expect(() => mergeRedactedSecretValues(incoming.root.secrets[0], vault.root.secrets[0]))
      .toThrow('Redacted secret field cannot be saved without a matching secret')
  })
})
