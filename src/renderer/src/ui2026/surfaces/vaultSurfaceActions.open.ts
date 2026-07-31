import type {
  VaultSearchResult,
  VaultSurfaceCollection,
  VaultSurfaceSecret,
} from './vaultSurfaceModel.open'

export type VaultLegacyWorkspaceView = 'dashboard' | 'folders'

type VaultSelection = {
  readonly selectFolder: (id: string | null) => void
  readonly selectSecret: (id: string | null) => void
  readonly onOpenLegacyWorkspace?: (view: VaultLegacyWorkspaceView) => void
}

export function createVaultSurfaceActions({
  selectFolder,
  selectSecret,
  onOpenLegacyWorkspace,
}: VaultSelection) {
  return {
    openSecret(secret: VaultSurfaceSecret): void {
      selectFolder(secret.folderId)
      selectSecret(secret.id)
      onOpenLegacyWorkspace?.('folders')
    },
    openCollection(collection: VaultSurfaceCollection): void {
      selectFolder(collection.id)
      selectSecret(null)
      onOpenLegacyWorkspace?.('folders')
    },
    openSearchResult(result: VaultSearchResult): void {
      if (result.kind === 'secret') {
        selectFolder(result.folderId)
        selectSecret(result.id)
      } else {
        selectFolder(result.id)
        selectSecret(null)
      }
      onOpenLegacyWorkspace?.('folders')
    },
    openWorkspace(): void {
      onOpenLegacyWorkspace?.('dashboard')
    },
  }
}
