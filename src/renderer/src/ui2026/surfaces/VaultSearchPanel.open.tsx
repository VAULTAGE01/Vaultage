import { Folder, KeyRound, X } from 'lucide-react'
import type { ReactElement, RefObject } from 'react'
import { CompactRow } from '../primitives.open'
import type { createVaultSurfaceActions } from './vaultSurfaceActions.open'
import type { searchVaultSurface } from './vaultSurfaceModel.open'

type VaultSearchResults = ReturnType<typeof searchVaultSurface>
type VaultActions = ReturnType<typeof createVaultSurfaceActions>

export function VaultSearchPanel({
  query,
  searchInput,
  searchResults,
  actions,
  onQueryChange,
  onClose,
}: {
  readonly query: string
  readonly searchInput: RefObject<HTMLInputElement>
  readonly searchResults: VaultSearchResults
  readonly actions: VaultActions
  readonly onQueryChange: (query: string) => void
  readonly onClose: () => void
}): ReactElement {
  return (
    <div className='ui26-vault-search'>
      <header>
        <label htmlFor='ui26-vault-filter'>Filter vault</label>
        <button type='button' onClick={onClose} aria-label='Close vault search'>
          <X size={15} aria-hidden />
        </button>
      </header>
      <input
        id='ui26-vault-filter'
        ref={searchInput}
        value={query.trimStart()}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder='Name, folder, type, or environment'
      />
      {query && searchResults.length ? (
        <div className='ui26-vault-search-results' aria-label='Vault search results'>
          {searchResults.map((result) => (
            <CompactRow
              key={result.kind + '-' + result.id}
              icon={result.kind === 'secret'
                ? <KeyRound size={16} aria-hidden />
                : <Folder size={16} aria-hidden />}
              title={result.name}
              detail={result.kind === 'secret'
                ? result.folderName + ' · ' + result.type
                : result.count + ' secrets'}
              onActivate={() => actions.openSearchResult(result)}
            />
          ))}
        </div>
      ) : query ? (
        <p className='ui26-muted'>No secrets or folders match this search.</p>
      ) : null}
    </div>
  )
}
