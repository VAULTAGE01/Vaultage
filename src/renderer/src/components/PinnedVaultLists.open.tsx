import type { ReactElement } from 'react'
import { Folder, KeyRound } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { flatSecrets } from '../lib/vaultTree'
import { isPinnedSecret } from '../lib/pinning'
import { SECRET_TYPE_LABELS } from '../types'
import type { VaultFolder } from '../types'

export type CommunityPinnedSecret = ReturnType<typeof flatSecrets>[number]

export type CommunityPinnedCollection = {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly secretCount: number
  readonly pinnedSecretCount: number
}

export function collectCommunityPinnedCollections(
  folder: VaultFolder,
  parentPath: readonly string[] = [],
): CommunityPinnedCollection[] {
  const path = [...parentPath, folder.name]
  return folder.children.flatMap(child => {
    const secrets = flatSecrets(child)
    const pinnedSecretCount = secrets.filter(({ secret }) => isPinnedSecret(secret)).length
    const collection = pinnedSecretCount > 0
      ? [{
          id: child.id,
          name: child.name,
          path: [...path, child.name].join(' › '),
          secretCount: secrets.length,
          pinnedSecretCount,
        }]
      : []
    return [...collection, ...collectCommunityPinnedCollections(child, path)]
  })
}

export function CommunityPinnedVaultLists({
  pinnedSecrets,
  pinnedCollections,
  onOpenSecret,
  onOpenCollection,
}: {
  readonly pinnedSecrets: readonly CommunityPinnedSecret[]
  readonly pinnedCollections: readonly CommunityPinnedCollection[]
  readonly onOpenSecret: (item: CommunityPinnedSecret) => void
  readonly onOpenCollection: (collection: CommunityPinnedCollection) => void
}): ReactElement {
  return (
    <Tabs defaultValue="secrets" className="mt-6">
      <TabsList aria-label="Pinned Vault items">
        <TabsTrigger value="secrets">
          Pinned secrets <span className="ml-1 text-[10px] text-muted">{pinnedSecrets.length}</span>
        </TabsTrigger>
        <TabsTrigger value="collections">
          Pinned collections <span className="ml-1 text-[10px] text-muted">{pinnedCollections.length}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="secrets" className="mt-3">
        <div className="grid gap-3 xl:grid-cols-3">
          {pinnedSecrets.length > 0 ? pinnedSecrets.map(item => (
            <button
              key={item.secret.id}
              type="button"
              className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-white/[0.16]"
              onClick={() => onOpenSecret(item)}
            >
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-yellow-300" />
                <strong className="truncate text-sm text-text">{item.secret.name}</strong>
              </span>
              <span className="mt-2 block truncate text-[11px] text-muted">
                {item.folderPath} · {SECRET_TYPE_LABELS[item.secret.type]}
              </span>
            </button>
          )) : (
            <p className="text-xs text-muted">Pin a secret to keep it close at hand.</p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="collections" className="mt-3">
        <div className="grid gap-3 xl:grid-cols-3">
          {pinnedCollections.length > 0 ? pinnedCollections.map(collection => (
            <button
              key={collection.id}
              type="button"
              className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-white/[0.16]"
              onClick={() => onOpenCollection(collection)}
            >
              <span className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-yellow-300" />
                <strong className="truncate text-sm text-text">{collection.name}</strong>
              </span>
              <span className="mt-2 block truncate text-[11px] text-muted">{collection.path}</span>
              <span className="mt-1 block text-[10px] text-text-secondary">
                {collection.pinnedSecretCount}/{collection.secretCount} pinned
              </span>
            </button>
          )) : (
            <p className="text-xs text-muted">Collections containing pinned secrets appear here.</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}
