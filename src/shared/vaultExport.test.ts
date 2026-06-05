import { describe, expect, it } from 'vitest'
import {
  serializeScopedVaultExportCsv,
  serializeScopedVaultExportJson,
} from './vaultExport'

const vault = {
  version: 2,
  revision: 7,
  root: {
    id: 'root',
    name: 'My Vault',
    secrets: [{
      id: 'root-secret',
      name: 'Root Login',
      type: 'password',
      fields: [
        { key: 'Username', value: 'eden', sensitive: false },
        { key: 'Password', value: 'root-pass', sensitive: true },
      ],
      notes: 'root note',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }],
    children: [{
      id: 'api-folder',
      name: 'API Keys',
      secrets: [{
        id: 'api-secret',
        name: 'Stripe, Live',
        type: 'apiKey',
        fields: [
          { key: 'Service', value: 'Stripe', sensitive: false },
          { key: 'API Key', value: 'sk_live_quote"value', sensitive: true },
        ],
        notes: 'billing',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        tags: ['payments'],
        providerLink: {
          providerId: 'provider-1',
          remoteName: 'STRIPE_KEY',
          createdInVaultage: false,
        },
      }],
      children: [],
    }],
  },
  providers: [{
    id: 'provider-1',
    name: 'Stripe Provider',
    type: 'custom',
    config: { token: 'provider-token' },
  }, {
    id: 'provider-2',
    name: 'Unused',
    type: 'custom',
    config: { token: 'unused-token' },
  }],
  providerGroups: [],
  envProjects: [{
    id: 'project-1',
    name: 'Billing App',
    path: '/tmp/billing',
    addToGitignore: true,
    entries: [
      { secretId: 'api-secret', fieldKey: 'API Key', envKey: 'STRIPE_API_KEY' },
      { secretId: 'root-secret', fieldKey: 'Password', envKey: 'ROOT_PASSWORD' },
    ],
  }],
}

describe('vault scoped exports', () => {
  it('exports a folder subtree and only linked provider/project metadata', () => {
    const exported = serializeScopedVaultExportJson(vault, { kind: 'folder', id: 'api-folder' }, '2026-05-31T12:00:00.000Z')
    const parsed = JSON.parse(exported.content)

    expect(exported.itemCount).toBe(1)
    expect(parsed.scope).toMatchObject({ kind: 'folder', id: 'api-folder', path: ['My Vault', 'API Keys'] })
    expect(parsed.vault.root).toMatchObject({ id: 'api-folder', name: 'API Keys' })
    expect(parsed.vault.root.secrets.map((secret: { id: string }) => secret.id)).toEqual(['api-secret'])
    expect(parsed.vault.providers.map((provider: { id: string }) => provider.id)).toEqual(['provider-1'])
    expect(parsed.vault.envProjects).toEqual([{
      id: 'project-1',
      name: 'Billing App',
      path: '/tmp/billing',
      addToGitignore: true,
      entries: [{ secretId: 'api-secret', fieldKey: 'API Key', envKey: 'STRIPE_API_KEY' }],
    }])
  })

  it('exports a single secret as CSV with escaped values', () => {
    const exported = serializeScopedVaultExportCsv(vault, { kind: 'secret', id: 'api-secret' }, '2026-05-31T12:00:00.000Z')

    expect(exported.itemCount).toBe(1)
    expect(exported.content).toContain('"API Keys","Stripe, Live","apiKey"')
    expect(exported.content).toContain('"sk_live_quote""value"')
    expect(exported.content).not.toContain('Root Login')
  })

  it('rejects missing scoped items', () => {
    expect(() => serializeScopedVaultExportJson(vault, { kind: 'secret', id: 'missing' }))
      .toThrow('Export secret not found')
    expect(() => serializeScopedVaultExportJson(vault, { kind: 'folder', id: 'missing' }))
      .toThrow('Export folder not found')
  })
})
