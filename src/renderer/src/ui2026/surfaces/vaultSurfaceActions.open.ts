import type {
  VaultSearchResult,
  VaultSurfaceCollection,
  VaultSurfaceSecret,
} from './vaultSurfaceModel.open'

export type VaultDetailTarget =
  | { readonly kind: 'secret'; readonly id: string }
  | { readonly kind: 'collection'; readonly id: string }

export type VaultSecretSelection = {
  readonly id: string
  readonly folderId: string
}

export type VaultWorkflow = 'add-secret' | 'import-export' | 'new-collection' | 'settings'

type VaultSurfaceActionContext = {
  readonly selectFolder: (id: string | null) => void
  readonly selectSecret: (id: string | null) => void
  readonly onOpenDetail: (target: VaultDetailTarget) => void
  readonly onOpenWorkflow: (workflow: VaultWorkflow) => void
}

export function createVaultSurfaceActions({
  selectFolder,
  selectSecret,
  onOpenDetail,
  onOpenWorkflow,
}: VaultSurfaceActionContext) {
  const openSecretSelection = (selection: VaultSecretSelection): void => {
    selectFolder(selection.folderId)
    selectSecret(selection.id)
    onOpenDetail({ kind: 'secret', id: selection.id })
  }

  return {
    openSecret(secret: VaultSurfaceSecret): void {
      openSecretSelection(secret)
    },
    openSecretSelection,
    openCollection(collection: VaultSurfaceCollection): void {
      selectFolder(collection.id)
      selectSecret(null)
      onOpenDetail({ kind: 'collection', id: collection.id })
    },
    openSearchResult(result: VaultSearchResult): void {
      if (result.kind === 'secret') {
        openSecretSelection(result)
      } else {
        selectFolder(result.id)
        selectSecret(null)
        onOpenDetail({ kind: 'collection', id: result.id })
      }
    },
    openAddSecret(): void {
      onOpenWorkflow('add-secret')
    },
    openImportOrExport(): void {
      onOpenWorkflow('import-export')
    },
    openNewCollection(): void {
      onOpenWorkflow('new-collection')
    },
    openVaultSettings(): void {
      onOpenWorkflow('settings')
    },
  }
}
