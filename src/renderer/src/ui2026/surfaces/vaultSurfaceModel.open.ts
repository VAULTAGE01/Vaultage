import { findFolder, flatSecrets } from '@/lib/vaultTree'
import { isPinnedSecret } from '@/lib/pinning'
import {
  CERTIFICATE_EXPIRY_REMINDER_DAYS,
  CertificateProjectionError,
  projectCertificateExpiry,
} from '../../../../shared/certificateMetadata'
import type { Environment } from '../primitives.open'
import type { VaultFolder, VaultRoot, VaultSecret } from '../../types'

export type VaultSurfaceSecret = {
  readonly id: string
  readonly folderId: string
  readonly folderName: string
  readonly name: string
  readonly type: string
  readonly environment: Environment
  readonly timestamp: string
  readonly reminderDueAt?: string
}

export type VaultSurfaceCollection = {
  readonly id: string
  readonly name: string
  readonly count: number
  readonly pinned: boolean
}

export type VaultSearchResult =
  | ({ readonly kind: 'secret' } & VaultSurfaceSecret)
  | { readonly kind: 'folder'; readonly id: string; readonly name: string; readonly count: number }

export type VaultTypeGroup = {
  readonly type: string
  readonly count: number
  readonly environments: readonly {
    readonly environment: Environment
    readonly count: number
  }[]
}

export type VaultSurfaceModel = {
  readonly totalSecrets: number
  readonly collectionCount: number
  readonly environments: number
  readonly pinnedSecrets: readonly VaultSurfaceSecret[]
  readonly recentSecrets: readonly VaultSurfaceSecret[]
  readonly reminders: readonly VaultSurfaceSecret[]
  readonly collections: readonly VaultSurfaceCollection[]
  readonly typeGroups: readonly VaultTypeGroup[]
  readonly searchIndex: readonly VaultSearchResult[]
}

export function filterVaultSurfaceModel(
  model: VaultSurfaceModel,
  query: string,
): VaultSurfaceModel {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return model
  const matches = (value: string): boolean => value.toLowerCase().includes(normalizedQuery)
  const matchesSecret = (secret: VaultSurfaceSecret): boolean => matches(
    secret.name + ' ' + secret.folderName + ' ' + secret.type + ' ' + secret.environment,
  )
  return {
    ...model,
    pinnedSecrets: model.pinnedSecrets.filter(matchesSecret),
    recentSecrets: model.recentSecrets.filter(matchesSecret),
    reminders: model.reminders.filter(matchesSecret),
    collections: model.collections.filter((collection) => matches(collection.name)),
    typeGroups: model.typeGroups.filter((group) =>
      matches(group.type) || group.environments.some((entry) => matches(entry.environment))),
  }
}

export function searchVaultSurface(
  model: VaultSurfaceModel,
  query: string,
): readonly VaultSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []
  return model.searchIndex.filter((result) => {
    const value = result.kind === 'secret'
      ? result.name + ' ' + result.folderName + ' ' + result.type + ' ' + result.environment
      : result.name
    return value.toLowerCase().includes(normalizedQuery)
  })
}

const environmentForScope = (scope?: string): Environment => {
  if (scope === 'production') return 'production'
  if (scope === 'staging') return 'staging'
  if (scope === 'development') return 'development'
  return 'local'
}

const secretTimestamp = (secret: VaultSecret): string =>
  secret.lastUsedAt ?? secret.updatedAt

function reminderDueAt(secret: VaultSecret, now: number): string | undefined {
  if (secret.type === 'certificate' && secret.certificate?.notBefore && secret.certificate.notAfter) {
    try {
      const projection = projectCertificateExpiry(secret.certificate, now)
      return projection.status === 'valid' || projection.status === 'not-yet-valid'
        ? undefined
        : projection.expiresAt
    } catch (error) {
      if (error instanceof CertificateProjectionError) return undefined
      throw error
    }
  }
  const expiryMs = typeof secret.expiresAt === 'string' ? Date.parse(secret.expiresAt) : Number.NaN
  return Number.isFinite(expiryMs) && expiryMs <= now + CERTIFICATE_EXPIRY_REMINDER_DAYS * 86_400_000
    ? secret.expiresAt
    : undefined
}

function countCollections(folder: VaultFolder): number {
  return folder.children.reduce((count, child) => count + 1 + countCollections(child), 0)
}

function listCollections(folder: VaultFolder): readonly VaultSurfaceCollection[] {
  return folder.children.flatMap((child) => [
    {
      id: child.id,
      name: child.name,
      count: flatSecrets(child).length,
      pinned: flatSecrets(child).some(({ secret }) => isPinnedSecret(secret)),
    },
    ...listCollections(child),
  ])
}

export function buildVaultSurfaceModel(
  vault: VaultRoot,
  now = Date.now(),
): VaultSurfaceModel {
  const secrets = flatSecrets(vault.root).map(({ folderId, secret }) => ({
    id: secret.id,
    folderId,
    folderName: findFolder(vault.root, folderId)?.name ?? vault.root.name,
    name: secret.name,
    type: secret.type,
    environment: environmentForScope(secret.scope),
    timestamp: secretTimestamp(secret),
    pinned: isPinnedSecret(secret),
    expiresAt: secret.expiresAt,
    reminderDueAt: reminderDueAt(secret, now),
  }))
  const typeGroups = new Map<string, Map<Environment, number>>()
  for (const secret of secrets) {
    const environments = typeGroups.get(secret.type) ?? new Map<Environment, number>()
    environments.set(
      secret.environment,
      (environments.get(secret.environment) ?? 0) + 1,
    )
    typeGroups.set(secret.type, environments)
  }
  const collections = [...listCollections(vault.root)]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const environments = new Set(secrets.map((secret) => secret.environment)).size
  const toSurfaceSecret = ({
    pinned: _pinned,
    expiresAt: _expiresAt,
    ...secret
  }: (typeof secrets)[number]): VaultSurfaceSecret => secret
  const allSurfaceSecrets = secrets.map(toSurfaceSecret)

  return {
    totalSecrets: secrets.length,
    collectionCount: countCollections(vault.root),
    environments,
    pinnedSecrets: secrets
      .filter((secret) => secret.pinned)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 5)
      .map(toSurfaceSecret),
    recentSecrets: [...secrets]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 5)
      .map(toSurfaceSecret),
    reminders: secrets
      .filter((secret) => secret.reminderDueAt !== undefined)
      .sort((a, b) => (a.reminderDueAt ?? '').localeCompare(b.reminderDueAt ?? ''))
      .slice(0, 3)
      .map(toSurfaceSecret),
    collections: collections.slice(0, 5),
    typeGroups: [...typeGroups]
      .map(([type, environmentsByType]) => ({
        type,
        count: [...environmentsByType.values()].reduce((total, count) => total + count, 0),
        environments: [...environmentsByType].map(([environment, count]) => ({
          environment,
          count,
        })),
      }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    searchIndex: [
      ...allSurfaceSecrets.map((secret) => ({ kind: 'secret' as const, ...secret })),
      ...collections.map((collection) => ({
        kind: 'folder' as const,
        id: collection.id,
        name: collection.name,
        count: collection.count,
      })),
    ],
  }
}
