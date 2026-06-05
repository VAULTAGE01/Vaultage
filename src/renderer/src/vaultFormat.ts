import type { VaultFolder, VaultRoot, VaultTreeItemRef } from './types'

export const MAX_VAULT_IMPORT_JSON_BYTES = 10 * 1024 * 1024

export function parseVaultJson(json: unknown): VaultRoot {
  if (typeof json !== 'string') throw new Error('Vault JSON must be a string')
  if (new TextEncoder().encode(json).byteLength > MAX_VAULT_IMPORT_JSON_BYTES) {
    throw new Error('Vault JSON is too large')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Vault JSON must be valid JSON')
  }

  return normaliseVault(unwrapVaultExport(parsed))
}

// Keep legacy pre-provider vaults readable while v2 format stabilizes.
export function normaliseVault(raw: unknown): VaultRoot {
  const v = asRecord(raw, 'Vault payload')
  if (typeof v.version !== 'number') throw new Error('Vault version must be a number')

  return {
    ...v,
    version: v.version,
    revision: typeof v.revision === 'number' && Number.isInteger(v.revision) && v.revision > 0 ? v.revision : 1,
    root: normaliseFolder(v.root, 'root'),
    providers: optionalArray(v.providers, 'providers'),
    providerGroups: optionalArray(v.providerGroups, 'providerGroups'),
    envProjects: optionalArray(v.envProjects, 'envProjects'),
  } as VaultRoot
}

function unwrapVaultExport(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const record = raw as Record<string, unknown>
  if (record.format === 'vaultage.export.v1' && record.vault !== undefined) {
    return record.vault
  }
  return raw
}

function normaliseFolder(raw: unknown, path: string): VaultFolder {
  const folder = asRecord(raw, `Vault folder ${path}`)
  if (typeof folder.id !== 'string' || !folder.id) throw new Error(`${path}.id must be a string`)
  if (typeof folder.name !== 'string') throw new Error(`${path}.name must be a string`)

  const children = optionalArray(folder.children, `${path}.children`)
    .map((child, index) => normaliseFolder(child, `${path}.children[${index}]`))
  const secrets = optionalArray(folder.secrets, `${path}.secrets`) as VaultFolder['secrets']

  return {
    ...folder,
    id: folder.id,
    name: folder.name,
    children,
    secrets,
    itemOrder: normaliseItemOrder(folder.itemOrder, children, secrets),
  } as VaultFolder
}

function normaliseItemOrder(
  raw: unknown,
  children: VaultFolder[],
  secrets: VaultFolder['secrets'],
): VaultTreeItemRef[] {
  const known = new Set([
    ...children.map(child => `folder:${child.id}`),
    ...secrets.map(secret => `secret:${secret.id}`),
  ])
  const seen = new Set<string>()
  const ordered: VaultTreeItemRef[] = []

  if (raw !== undefined) {
    if (!Array.isArray(raw)) throw new Error('folder.itemOrder must be an array')
    for (const item of raw) {
      const ref = asRecord(item, 'folder.itemOrder item')
      if (ref.kind !== 'folder' && ref.kind !== 'secret') continue
      if (typeof ref.id !== 'string' || !ref.id) continue
      const key = `${ref.kind}:${ref.id}`
      if (!known.has(key) || seen.has(key)) continue
      seen.add(key)
      ordered.push({ kind: ref.kind, id: ref.id })
    }
  }

  for (const secret of secrets) {
    const key = `secret:${secret.id}`
    if (!seen.has(key)) ordered.push({ kind: 'secret', id: secret.id })
  }
  for (const child of children) {
    const key = `folder:${child.id}`
    if (!seen.has(key)) ordered.push({ kind: 'folder', id: child.id })
  }

  return ordered
}

function optionalArray(value: unknown, field: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}
