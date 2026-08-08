import { Archive, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { DragEvent, ReactElement, ReactNode } from 'react'
import type { VaultCollectionSnapshot } from '../../../../shared/vaultIpcContracts'

export type VaultEntry = VaultCollectionSnapshot['vaults'][number]

export type ActiveVaultRootInteraction = {
  readonly canAcceptDrop: boolean
  readonly dropInside: boolean
  readonly onOpen: () => void
  readonly onDragEnter: (event: DragEvent<HTMLButtonElement>) => void
  readonly onDragOver: (event: DragEvent<HTMLButtonElement>) => void
  readonly onDrop: (event: DragEvent<HTMLButtonElement>) => void
}

type VaultSelectorListProps = {
  readonly collection: VaultCollectionSnapshot | null
  readonly pendingVaultId: string | null
  readonly activeContent?: ReactNode
  readonly activeVaultRoot?: ActiveVaultRootInteraction
  readonly onCreate: () => void
  readonly onSwitch: (vaultId: string) => void
  readonly onRename: (vault: VaultEntry) => void
  readonly onSetArchived: (vault: VaultEntry, archived: boolean) => void
  readonly onDelete: (vault: VaultEntry) => void
}

export function VaultSelectorList({
  collection,
  pendingVaultId,
  activeContent,
  activeVaultRoot,
  onCreate,
  onSwitch,
  onRename,
  onSetArchived,
  onDelete,
}: VaultSelectorListProps): ReactElement {
  if (!collection) {
    return <p className='px-2 py-2 text-xs text-muted'>Loading vaults…</p>
  }

  return (
    <section
      className='grid min-w-0 gap-1'
      data-vault-hierarchy='sidebar'
      aria-label='Vaults'
    >
      <header className='flex items-center justify-between gap-2 px-2 pb-1'>
        <h3 className='text-[10px] font-semibold uppercase tracking-wider text-muted'>Vaults</h3>
        <button
          type='button'
          className='flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'
          data-vault-action='create'
          disabled={pendingVaultId !== null}
          onClick={onCreate}
        >
          <Plus size='1em' aria-hidden />
          New
        </button>
      </header>
      <div className='grid min-w-0 gap-0.5'>
        {collection.vaults.map(vault => {
          const active = collection.activeVaultId === vault.id
          const canArchive = !active
          const canDelete = vault.archived && !active && collection.vaults.length > 1
          const hasActiveContent = active && activeContent !== undefined

          return (
            <div className='min-w-0' data-vault-id={vault.id} key={vault.id}>
              <div className='flex min-w-0 items-center gap-1'>
                <button
                  type='button'
                  className={`flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[current=true]:bg-white/10 aria-[current=true]:text-text disabled:cursor-not-allowed disabled:opacity-60 ${active && activeVaultRoot?.dropInside ? 'ring-1 ring-white/[0.14]' : ''}`}
                  data-vault-action='switch'
                  data-vault-id={vault.id}
                  aria-current={active ? 'true' : undefined}
                  disabled={vault.archived || pendingVaultId !== null}
                  onDragEnter={active ? activeVaultRoot?.onDragEnter : undefined}
                  onDragOver={active ? activeVaultRoot?.onDragOver : undefined}
                  onDrop={active ? activeVaultRoot?.onDrop : undefined}
                  onClick={() => {
                    if (active) activeVaultRoot?.onOpen()
                    else onSwitch(vault.id)
                  }}
                  data-vault-root-drop={active && activeVaultRoot?.canAcceptDrop ? 'enabled' : undefined}
                  data-vault-root-drop-active={active && activeVaultRoot?.dropInside ? 'true' : undefined}
                >
                  <span className='min-w-0 flex-1 truncate'>{vault.name}</span>
                  <small className='shrink-0 text-[10px] text-muted'>
                    {active ? 'Active' : vault.archived ? 'Archived' : 'Switch'}
                  </small>
                </button>
                <div className='flex shrink-0 items-center gap-0.5' aria-label={`${vault.name} actions`}>
                  <button
                    type='button'
                    aria-label={`Rename ${vault.name}`}
                    data-vault-action='rename'
                    disabled={pendingVaultId !== null}
                    onClick={() => onRename(vault)}
                    className='grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    <Pencil size='1em' aria-hidden />
                  </button>
                  {canArchive ? (
                    <button
                      type='button'
                      aria-label={vault.archived ? `Restore ${vault.name}` : `Archive ${vault.name}`}
                      data-vault-action={vault.archived ? 'restore' : 'archive'}
                      disabled={pendingVaultId !== null}
                      onClick={() => onSetArchived(vault, !vault.archived)}
                      className='grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      {vault.archived
                        ? <RotateCcw size='1em' aria-hidden />
                        : <Archive size='1em' aria-hidden />}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type='button'
                      aria-label={`Delete ${vault.name}`}
                      data-vault-action='delete'
                      disabled={pendingVaultId !== null}
                      onClick={() => onDelete(vault)}
                      className='grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      <Trash2 size='1em' aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
              {hasActiveContent ? (
                <div
                  className='ml-3 min-w-0 border-l border-border/70 pl-1.5'
                  data-vault-content-for={vault.id}
                >
                  {activeContent}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
