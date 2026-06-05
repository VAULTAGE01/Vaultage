import { describe, expect, it } from 'vitest'
import { REDACTED_PROVIDER_CONFIG_VALUE, REDACTED_SECRET_VALUE } from '../shared/vaultRedaction'
import { mergeRedactedVaultValues, redactVaultForRenderer } from './vaultRedaction'

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

type MergedVault = typeof vault & {
  preferences: typeof vault.preferences & {
    quickRevealPinEnabled?: boolean
  }
}

describe('vault redaction', () => {
  it('redacts sensitive field values and provider credentials without changing non-sensitive values', () => {
    const redacted = redactVaultForRenderer(vault) as RedactedVault

    expect(redacted.root.secrets[0].fields).toEqual([
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

  it('preserves current values when a redacted renderer payload is saved', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].name = 'Renamed API'
    incoming.root.secrets[0].fields[0].value = 'Example, Inc.'

    const merged = mergeRedactedVaultValues(incoming, vault) as MergedVault

    expect(merged.root.secrets[0].name).toBe('Renamed API')
    expect(merged.root.secrets[0].fields).toEqual([
      { key: 'Service', value: 'Example, Inc.', sensitive: false },
      { key: 'Token', value: 'real-token', sensitive: true },
      { key: 'Token', value: 'second-token', sensitive: true },
      { key: 'Empty', value: '', sensitive: true },
    ])
    expect(merged.providers[0].config.token).toBe('provider-token')
    expect(merged.preferences.quickRevealPin).toEqual(vault.preferences.quickRevealPin)
    expect(merged.preferences.quickRevealPinEnabled).toBe(true)
    expect(merged.root.children[0].secrets[0].fields[0].value).toBe('nested-password')
  })

  it('allows a renderer payload to replace a provider credential intentionally', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.providers[0].config.token = 'new-provider-token'

    const merged = mergeRedactedVaultValues(incoming, vault) as typeof vault

    expect(merged.providers[0].config.token).toBe('new-provider-token')
  })

  it('allows a renderer payload to replace a sensitive value intentionally', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].fields[1].value = 'rotated-token'

    const merged = mergeRedactedVaultValues(incoming, vault) as typeof vault

    expect(merged.root.secrets[0].fields[1].value).toBe('rotated-token')
    expect(merged.root.secrets[0].fields[2].value).toBe('second-token')
  })

  it('preserves a redacted value when the field label is renamed', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].fields[1].key = 'Renamed Token'

    const merged = mergeRedactedVaultValues(incoming, vault) as typeof vault

    expect(merged.root.secrets[0].fields[1]).toEqual({
      key: 'Renamed Token',
      value: 'real-token',
      sensitive: true,
    })
  })

  it('rejects stale redaction placeholders that no longer match a current field', () => {
    const incoming = redactVaultForRenderer(vault) as RedactedVault
    incoming.root.secrets[0].id = 'new-secret-id'

    expect(() => mergeRedactedVaultValues(incoming, vault))
      .toThrow('Redacted secret field cannot be saved without a current value')
  })
})
