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
  it('preserves every saved Project and the active selection in full-vault export', () => {
    const projects = ['project-a', 'project-b', 'project-c'].map(id => ({
      id,
      name: id,
      path: `/${id}`,
      entries: [],
      addToGitignore: true,
    }))
    const exported = serializeScopedVaultExportJson({
      ...vault,
      envProjects: projects,
      preferences: { activeEnvProjectIds: ['project-a', 'project-b'] },
    }, { kind: 'vault' }, '2026-05-31T12:00:00.000Z')
    const parsed = JSON.parse(exported.content)

    expect(parsed.vault.envProjects.map((project: { id: string }) => project.id))
      .toEqual(['project-a', 'project-b', 'project-c'])
    expect(parsed.vault.preferences.activeEnvProjectIds).toEqual(['project-a', 'project-b'])
  })

  it('exports only the selected folder subtree without provider credentials or Project paths', () => {
    const exported = serializeScopedVaultExportJson(vault, { kind: 'folder', id: 'api-folder' }, '2026-05-31T12:00:00.000Z')
    const parsed = JSON.parse(exported.content)

    expect(exported.itemCount).toBe(1)
    expect(parsed.scope).toMatchObject({ kind: 'folder', id: 'api-folder', path: ['My Vault', 'API Keys'] })
    expect(parsed.vault.root).toMatchObject({ id: 'api-folder', name: 'API Keys' })
    expect(parsed.vault.root.secrets.map((secret: { id: string }) => secret.id)).toEqual(['api-secret'])
    expect(parsed.vault.root.secrets[0].providerLink).toBeUndefined()
    expect(parsed.vault.providers).toEqual([])
    expect(parsed.vault.providerGroups).toEqual([])
    expect(parsed.vault.envProjects).toEqual([])
    expect(exported.content).not.toContain('provider-token')
    expect(exported.content).not.toContain('/tmp/billing')
  })

  it('does not widen a scoped export through linked environment mappings', () => {
    const exported = serializeScopedVaultExportJson({
      ...vault,
      envProjects: [{
        id: 'project-1',
        name: 'Billing App',
        path: '/tmp/billing',
        addToGitignore: true,
        entries: [],
        environments: [{
          id: 'project-1:local',
          name: 'Local',
          scope: 'development',
          kind: 'local',
          path: '/tmp/billing',
          addToGitignore: true,
          entries: [
            { secretId: 'api-secret', fieldKey: 'API Key', envKey: 'STRIPE_API_KEY' },
            { secretId: 'root-secret', fieldKey: 'Password', envKey: 'ROOT_PASSWORD' },
          ],
        }, {
          id: 'project-1:prod',
          name: 'Production',
          scope: 'production',
          kind: 'cloud',
          providerId: 'provider-1',
          entries: [{ secretId: 'root-secret', fieldKey: 'Password', envKey: 'ROOT_PASSWORD' }],
        }],
      }],
    }, { kind: 'folder', id: 'api-folder' }, '2026-05-31T12:00:00.000Z')
    const parsed = JSON.parse(exported.content)

    expect(parsed.vault.envProjects).toEqual([])
    expect(exported.content).not.toContain('STRIPE_API_KEY')
    expect(exported.content).not.toContain('/tmp/billing')
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
