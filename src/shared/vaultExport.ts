export type VaultExportFormat = 'json' | 'csv' | 'encrypted'

const MAX_CSV_CELL_CHARS = 32 * 1024

export type VaultExportScope =
  | { kind: 'vault' }
  | { kind: 'folder'; id: string }
  | { kind: 'secret'; id: string }

export interface ScopedVaultExport {
  data: unknown
  itemCount: number
  fileStem: string
  scopeLabel: string
}

interface FolderLike {
  id?: unknown
  name?: unknown
  children?: unknown
  secrets?: unknown
  itemOrder?: unknown
  [key: string]: unknown
}

interface SecretLike {
  id?: unknown
  name?: unknown
  type?: unknown
  fields?: unknown
  notes?: unknown
  description?: unknown
  scope?: unknown
  tags?: unknown
  expiresAt?: unknown
  usedIn?: unknown
  lastUsedAt?: unknown
  usageCount?: unknown
  providerLink?: unknown
  [key: string]: unknown
}

interface FieldLike {
  key?: unknown
  value?: unknown
  sensitive?: unknown
}

interface LocatedFolder {
  folder: FolderLike
  path: string[]
}

interface LocatedSecret {
  secret: SecretLike
  folder: FolderLike
  folderPath: string[]
}

interface SecretRow {
  secret: SecretLike
  folderPath: string[]
}

export function buildScopedVaultExport(
  vault: unknown,
  scope: VaultExportScope,
  exportedAt = new Date().toISOString(),
): ScopedVaultExport {
  const root = vaultRoot(vault)

  if (scope.kind === 'vault') {
    const itemCount = countSecrets(root)
    return {
      data: exportEnvelope(cloneJsonValue(vault), scope, itemCount, 'Entire vault', exportedAt),
      itemCount,
      fileStem: 'vaultage-vault',
      scopeLabel: 'Entire vault',
    }
  }

  if (scope.kind === 'folder') {
    const located = findFolder(root, scope.id)
    if (!located) throw new Error('Export folder not found')
    const folder = cloneJsonValue(located.folder) as FolderLike
    stripScopedProviderLinks(folder)
    const itemCount = countSecrets(folder)
    const scopedVault = scopedVaultPayload(vault, folder)
    const scopeLabel = located.path.join(' / ')
    return {
      data: exportEnvelope(scopedVault, { ...scope, path: located.path }, itemCount, scopeLabel, exportedAt),
      itemCount,
      fileStem: `vaultage-folder-${slugify(String(located.folder.name ?? 'folder'))}`,
      scopeLabel,
    }
  }

  const located = findSecret(root, scope.id)
  if (!located) throw new Error('Export secret not found')
  const secret = cloneJsonValue(located.secret) as SecretLike
  delete secret.providerLink
  const folderId = stringValue(located.folder.id) || 'export-folder'
  const folderName = stringValue(located.folder.name) || 'Exported Secret'
  const exportRoot: FolderLike = {
    id: folderId,
    name: folderName,
    children: [],
    secrets: [secret],
    itemOrder: [{ kind: 'secret', id: stringValue(secret.id) }],
  }
  const scopedVault = scopedVaultPayload(vault, exportRoot)
  const secretName = stringValue(secret.name) || 'secret'
  const scopeLabel = [...located.folderPath, secretName].join(' / ')
  return {
    data: exportEnvelope(scopedVault, { ...scope, folderPath: located.folderPath }, 1, scopeLabel, exportedAt),
    itemCount: 1,
    fileStem: `vaultage-secret-${slugify(secretName)}`,
    scopeLabel,
  }
}

export function serializeScopedVaultExportJson(
  vault: unknown,
  scope: VaultExportScope,
  exportedAt?: string,
): ScopedVaultExport & { content: string } {
  const built = buildScopedVaultExport(vault, scope, exportedAt)
  return { ...built, content: JSON.stringify(built.data, null, 2) }
}

export function serializeScopedVaultExportCsv(
  vault: unknown,
  scope: VaultExportScope,
  exportedAt?: string,
): ScopedVaultExport & { content: string } {
  const built = buildScopedVaultExport(vault, scope, exportedAt)
  const scopedRoot = vaultRoot((built.data as { vault?: unknown }).vault)
  const rows = flatSecrets(scopedRoot)
  const header = [
    'Folder',
    'Title',
    'Type',
    'Username',
    'Password',
    'URL',
    'Service',
    'API Key',
    'Secret',
    'Public Key',
    'Private Key',
    'Content',
    'Notes',
    'Description',
    'Scope',
    'Tags',
    'Used In',
    'Expires At',
    'Last Used At',
    'Usage Count',
    'Custom Fields',
  ]

  const content = [
    header,
    ...rows.map(row => csvRow(row)),
  ].map(values => values.map(csvCell).join(',')).join('\n') + '\n'

  return { ...built, content }
}

function exportEnvelope(
  vault: unknown,
  scope: Record<string, unknown>,
  itemCount: number,
  scopeLabel: string,
  exportedAt: string,
): unknown {
  return {
    format: 'vaultage.export.v1',
    exportedAt,
    scope,
    scopeLabel,
    itemCount,
    vault,
  }
}

function scopedVaultPayload(
  vault: unknown,
  root: FolderLike,
): unknown {
  const source = asRecord(vault, 'Vault payload')

  return {
    version: source.version,
    revision: source.revision,
    root,
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function stripScopedProviderLinks(folder: FolderLike): void {
  if (Array.isArray(folder.secrets)) {
    for (const secret of folder.secrets) {
      if (isRecord(secret)) delete secret.providerLink
    }
  }
  if (Array.isArray(folder.children)) {
    for (const child of folder.children) {
      if (isRecord(child)) stripScopedProviderLinks(child)
    }
  }
}

function csvRow({ secret, folderPath }: SecretRow): string[] {
  const fields = fieldList(secret)
  const fieldValue = (...keys: string[]) => {
    const wanted = new Set(keys.map(key => key.toLowerCase()))
    const field = fields.find(item => wanted.has(String(item.key ?? '').toLowerCase()))
    return csvFieldValue(secret, field)
  }

  return [
    folderPath.join(' / '),
    stringValue(secret.name),
    stringValue(secret.type),
    fieldValue('Username', 'Login', 'Email'),
    fieldValue('Password'),
    fieldValue('URL', 'Website', 'Web Site'),
    fieldValue('Service'),
    fieldValue('API Key', 'Token'),
    fieldValue('Secret'),
    fieldValue('Public Key'),
    fieldValue('Private Key'),
    fieldValue('Content'),
    stringValue(secret.notes),
    stringValue(secret.description),
    stringValue(secret.scope),
    arrayString(secret.tags),
    arrayString(secret.usedIn),
    stringValue(secret.expiresAt),
    stringValue(secret.lastUsedAt),
    numberString(secret.usageCount),
    JSON.stringify(fields.map(field => ({
      key: stringValue(field.key),
      value: csvFieldValue(secret, field),
      sensitive: field.sensitive === true,
    }))),
  ]
}

function csvFieldValue(secret: SecretLike, field?: FieldLike): string {
  if (!field) return ''
  if (secret.type === 'image' && field.key === '__image__') return '[image omitted from CSV export]'
  const value = stringValue(field.value)
  if (value.length <= MAX_CSV_CELL_CHARS) return value
  return `${value.slice(0, MAX_CSV_CELL_CHARS)}[truncated for CSV export]`
}

function findFolder(folder: FolderLike, id: string, path: string[] = []): LocatedFolder | null {
  const currentPath = [...path, stringValue(folder.name) || 'Folder']
  if (folder.id === id) return { folder, path: currentPath }
  for (const child of childFolders(folder)) {
    const found = findFolder(child, id, currentPath)
    if (found) return found
  }
  return null
}

function findSecret(folder: FolderLike, id: string, path: string[] = []): LocatedSecret | null {
  const currentPath = [...path, stringValue(folder.name) || 'Folder']
  for (const secret of childSecrets(folder)) {
    if (secret.id === id) return { secret, folder, folderPath: currentPath }
  }
  for (const child of childFolders(folder)) {
    const found = findSecret(child, id, currentPath)
    if (found) return found
  }
  return null
}

function flatSecrets(folder: FolderLike, path: string[] = []): SecretRow[] {
  const currentPath = [...path, stringValue(folder.name) || 'Folder']
  return [
    ...childSecrets(folder).map(secret => ({ secret, folderPath: currentPath })),
    ...childFolders(folder).flatMap(child => flatSecrets(child, currentPath)),
  ]
}

function countSecrets(folder: FolderLike): number {
  return childSecrets(folder).length + childFolders(folder).reduce((sum, child) => sum + countSecrets(child), 0)
}

function vaultRoot(vault: unknown): FolderLike {
  const record = asRecord(vault, 'Vault payload')
  if (!isRecord(record.root)) throw new Error('Vault payload root must be an object')
  return record.root as FolderLike
}

function childFolders(folder: FolderLike): FolderLike[] {
  return Array.isArray(folder.children) ? folder.children.filter(isRecord) as FolderLike[] : []
}

function childSecrets(folder: FolderLike): SecretLike[] {
  return Array.isArray(folder.secrets) ? folder.secrets.filter(isRecord) as SecretLike[] : []
}

function fieldList(secret: SecretLike): FieldLike[] {
  return Array.isArray(secret.fields) ? secret.fields.filter(isRecord) as FieldLike[] : []
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function arrayString(value: unknown): string {
  return Array.isArray(value)
    ? value.map(item => String(item)).join('; ')
    : ''
}

function numberString(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'export'
}

function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
