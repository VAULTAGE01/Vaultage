import { describe, expect, it } from 'vitest'
import { MAX_VAULT_IMPORT_JSON_BYTES, normaliseVault, parseVaultJson } from './vaultFormat'
import type { SecretType, VaultFolder, VaultRoot, VaultSecret } from './types'

const minimalVault = {
  version: 2,
  root: {
    id: 'root',
    name: 'My Vault',
    children: [],
    secrets: [],
  },
}

type GeneratedFolder = Omit<VaultFolder, 'children' | 'secrets'> & {
  children?: GeneratedFolder[]
  secrets?: VaultSecret[]
  folderMetadata?: Record<string, unknown>
}

type GeneratedVault = Omit<VaultRoot, 'root'> & {
  root: GeneratedFolder
  futureRootMetadata?: Record<string, unknown>
}

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function int(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[int(random, 0, values.length - 1)]
}

function text(random: () => number, prefix: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-_ ./:'
  const length = int(random, 3, 18)
  let value = prefix
  for (let i = 0; i < length; i++) value += alphabet[int(random, 0, alphabet.length - 1)]
  return value.trim()
}

function generatedSecret(random: () => number, index: string, providerAvailable: boolean): VaultSecret {
  const type = pick<SecretType>(random, ['password', 'apiKey', 'sshKey', 'secureNote', 'custom', 'image'])
  const now = `2026-05-${String(int(random, 1, 28)).padStart(2, '0')}T12:00:00.000Z`
  return {
    id: `secret-${index}`,
    name: text(random, 'secret-'),
    type,
    fields: type === 'image'
      ? [{ key: '__image__', value: 'data:image/png;base64,AAAA', sensitive: true }]
      : [
          { key: 'value', value: text(random, 'value-'), sensitive: true },
          { key: 'label', value: text(random, 'label-'), sensitive: false },
        ],
    notes: text(random, 'notes-'),
    createdAt: now,
    updatedAt: now,
    description: random() > 0.55 ? text(random, 'description-') : undefined,
    scope: random() > 0.5 ? pick(random, ['production', 'staging', 'development', 'testing']) : undefined,
    tags: random() > 0.45 ? [text(random, 'tag-'), text(random, 'tag-')] : undefined,
    providerLink: providerAvailable && random() > 0.75
      ? {
          providerId: 'provider-1',
          remoteName: text(random, 'remote-'),
          createdInVaultage: random() > 0.5,
          scopes: [text(random, 'scope-')],
        }
      : undefined,
  }
}

function generatedFolder(
  random: () => number,
  path: string,
  depth: number,
  providerAvailable: boolean,
): GeneratedFolder {
  const childCount = depth > 0 ? int(random, 0, 2) : 0
  const secretCount = int(random, 0, 3)
  const folder: GeneratedFolder = {
    id: `folder-${path}`,
    name: text(random, 'folder-'),
    folderMetadata: random() > 0.6 ? { order: int(random, 0, 99), label: text(random, 'meta-') } : undefined,
  }

  if (random() > 0.25 || depth === 2) {
    folder.children = Array.from({ length: childCount }, (_, index) =>
      generatedFolder(random, `${path}-${index}`, depth - 1, providerAvailable))
  }
  if (random() > 0.25) {
    folder.secrets = Array.from({ length: secretCount }, (_, index) =>
      generatedSecret(random, `${path}-${index}`, providerAvailable))
  }

  return folder
}

function generatedVault(seed: number): GeneratedVault {
  const random = rng(seed)
  const providerAvailable = random() > 0.35
  return {
    version: 2,
    root: generatedFolder(random, `root-${seed}`, 2, providerAvailable),
    providers: providerAvailable
      ? [{
          id: 'provider-1',
          name: text(random, 'provider-'),
          type: pick(random, ['doppler', 'vercel', 'cloudflare', 'gitlab', 'custom']),
          config: { baseUrl: 'https://example.test', token: text(random, 'token-') },
        }]
      : [],
    envProjects: random() > 0.35
      ? [{
          id: 'env-1',
          name: text(random, 'project-'),
          path: `/tmp/${text(random, 'path-').replaceAll(' ', '-')}`,
          entries: [],
          addToGitignore: random() > 0.5,
        }]
      : [],
    futureRootMetadata: { seed, note: text(random, 'future-') },
  }
}

function assertFolderArrays(folder: VaultFolder): void {
  expect(Array.isArray(folder.children)).toBe(true)
  expect(Array.isArray(folder.secrets)).toBe(true)
  for (const child of folder.children) assertFolderArrays(child)
}

describe('normaliseVault', () => {
  it('adds missing optional arrays for legacy local vaults', () => {
    const vault = normaliseVault(minimalVault)

    expect(vault.providers).toEqual([])
    expect(vault.envProjects).toEqual([])
  })

  it('preserves existing provider and env project arrays', () => {
    const input: VaultRoot = {
      ...minimalVault,
      providers: [{
        id: 'provider-1',
        name: 'Example',
        type: 'custom',
        config: { baseUrl: 'https://example.test' },
      }],
      envProjects: [{
        id: 'project-1',
        name: 'App',
        path: '/tmp/app',
        entries: [],
        addToGitignore: true,
      }],
    }

    const vault = normaliseVault(input)

    expect(vault.providers).toHaveLength(1)
    expect(vault.envProjects).toHaveLength(1)
  })

  it('normalises legacy folders with missing child and secret arrays recursively', () => {
    const vault = normaliseVault({
      version: 2,
      root: {
        id: 'root',
        name: 'My Vault',
        children: [{
          id: 'nested',
          name: 'Nested',
        }],
      },
    })

    expect(vault.root.secrets).toEqual([])
    expect(vault.root.children[0]).toMatchObject({
      id: 'nested',
      name: 'Nested',
      children: [],
      secrets: [],
    })
  })

  it('preserves unknown fields during pre-release format normalisation', () => {
    const vault = normaliseVault({
      ...minimalVault,
      futureRootMetadata: 'keep',
      root: {
        ...minimalVault.root,
        displayOrder: 7,
        secrets: [{
          id: 'secret-1',
          name: 'API Key',
          type: 'apiKey',
          fields: [],
          notes: '',
          createdAt: '2026-05-19T00:00:00.000Z',
          updatedAt: '2026-05-19T00:00:00.000Z',
          futureSecretMetadata: true,
        }],
      },
    }) as VaultRoot & { futureRootMetadata: string }

    expect(vault.futureRootMetadata).toBe('keep')
    expect((vault.root as VaultRoot['root'] & { displayOrder: number }).displayOrder).toBe(7)
    expect((vault.root.secrets[0] as VaultRoot['root']['secrets'][number] & { futureSecretMetadata: boolean }).futureSecretMetadata).toBe(true)
  })

  it('rejects corrupt root shapes instead of silently normalising them', () => {
    expect(() => normaliseVault(null)).toThrow('Vault payload must be an object')
    expect(() => normaliseVault({ version: '2', root: minimalVault.root }))
      .toThrow('Vault version must be a number')
    expect(() => normaliseVault({ version: 2, root: { id: 'root', name: 'Vault' }, providers: {} }))
      .toThrow('providers must be an array')
    expect(() => normaliseVault({ version: 2, root: { id: 'root', name: 42 } }))
      .toThrow('root.name must be a string')
  })
})

describe('parseVaultJson', () => {
  it('parses and normalises exported JSON vault payloads', () => {
    const vault = parseVaultJson(JSON.stringify(minimalVault))

    expect(vault.root.children).toEqual([])
    expect(vault.root.secrets).toEqual([])
    expect(vault.providers).toEqual([])
    expect(vault.envProjects).toEqual([])
  })

  it('parses Vaultage scoped export envelopes', () => {
    const vault = parseVaultJson(JSON.stringify({
      format: 'vaultage.export.v1',
      exportedAt: '2026-05-31T12:00:00.000Z',
      scope: { kind: 'folder', id: 'root' },
      vault: minimalVault,
    }))

    expect(vault.root.id).toBe('root')
    expect(vault.providers).toEqual([])
    expect(vault.envProjects).toEqual([])
  })

  it('round-trips generated v2 vault payloads without dropping metadata', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const fromImport = parseVaultJson(JSON.stringify(generatedVault(seed)))
      const fromExport = parseVaultJson(JSON.stringify(fromImport))

      expect(fromExport).toEqual(fromImport)
      expect((fromExport as VaultRoot & { futureRootMetadata?: { seed?: number } }).futureRootMetadata?.seed)
        .toBe(seed)
      assertFolderArrays(fromExport.root)
    }
  })

  it('normalises generated legacy folder omissions during JSON import', () => {
    for (let seed = 41; seed <= 55; seed++) {
      const vault = generatedVault(seed)
      delete vault.root.children
      delete vault.root.secrets

      const imported = parseVaultJson(JSON.stringify(vault))

      expect(imported.root.children).toEqual([])
      expect(imported.root.secrets).toEqual([])
      expect(imported.providers).toEqual(vault.providers)
      expect(imported.envProjects).toEqual(vault.envProjects)
    }
  })

  it('rejects non-string, invalid, oversized, and corrupt JSON imports', () => {
    expect(() => parseVaultJson({})).toThrow('Vault JSON must be a string')
    expect(() => parseVaultJson('{bad json')).toThrow('Vault JSON must be valid JSON')
    expect(() => parseVaultJson('[]')).toThrow('Invalid vault at $: must be an object')
    expect(() => parseVaultJson('x'.repeat(MAX_VAULT_IMPORT_JSON_BYTES + 1)))
      .toThrow('Vault JSON is too large')
    expect(() => parseVaultJson(JSON.stringify({ version: 2, root: { id: '', name: 'Vault' } })))
      .toThrow('Invalid vault at $.root.id: must not be empty')
  })
})
