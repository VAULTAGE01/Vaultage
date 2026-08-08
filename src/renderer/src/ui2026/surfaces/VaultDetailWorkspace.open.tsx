import { ArrowLeft, FolderOpen, KeyRound } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { useVault } from '../../vaultContext'
import { findFolder, findSecret, flatSecrets } from '../../lib/vaultTree'
import { SECRET_TYPE_LABELS } from '../../types'
import type { VaultDetailTarget, VaultSecretSelection } from './vaultSurfaceActions.open'
import './VaultDetailWorkspace.open.css'

type VaultDetailWorkspaceProps = {
  readonly target: VaultDetailTarget
  readonly onBack: () => void
  readonly onOpenSecret: (selection: VaultSecretSelection) => void
  readonly secretDetail: ReactNode
}

export function VaultDetailWorkspace({ target, onBack, onOpenSecret, secretDetail }: VaultDetailWorkspaceProps): ReactElement {
  const { state } = useVault()
  if (!state.vault) return <MissingVaultItem onBack={onBack} />

  if (target.kind === 'secret') {
    const result = findSecret(state.vault.root, target.id)
    if (!result) return <MissingVaultItem onBack={onBack} />
    const folder = findFolder(state.vault.root, result.folderId)
    return (
      <article className='ui26-vault-detail-workspace' data-ui26-vault-detail-kind='secret' aria-labelledby='ui26-vault-detail-title'>
        <DetailToolbar breadcrumb={`Vault / ${folder?.name ?? 'Collection'} / ${result.secret.name}`} title={result.secret.name} onBack={onBack} />
        <div className='ui26-vault-detail-body'>{secretDetail}</div>
      </article>
    )
  }

  const collection = findFolder(state.vault.root, target.id)
  if (!collection) return <MissingVaultItem onBack={onBack} />
  const secrets = flatSecrets(collection)
  return (
    <article className='ui26-vault-detail-workspace' data-ui26-vault-detail-kind='collection' aria-labelledby='ui26-vault-detail-title'>
      <DetailToolbar breadcrumb={`Vault / ${collection.name}`} title={collection.name} onBack={onBack} />
      <div className='ui26-vault-detail-body is-collection'>
        <section className='ui26-vault-collection-detail'>
          <header className='ui26-vault-collection-hero'>
            <span aria-hidden><FolderOpen size={22} /></span>
            <div><p>Collection</p><h1>{collection.name}</h1><span>{secrets.length} secret{secrets.length === 1 ? '' : 's'} in this collection.</span></div>
          </header>
          {secrets.length ? (
            <ul className='ui26-vault-collection-items' aria-label={`${collection.name} secrets`}>
              {secrets.map(({ secret, folderId, folderPath }) => (
                <li key={secret.id}>
                  <button type='button' onClick={() => onOpenSecret({ id: secret.id, folderId })}>
                    <KeyRound size={16} aria-hidden />
                    <span><strong>{secret.name}</strong><small>{folderPath} · {SECRET_TYPE_LABELS[secret.type]}</small></span>
                    <em>View details</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : <div className='ui26-vault-detail-empty' role='status'><FolderOpen size={22} aria-hidden /><strong>This collection is empty</strong></div>}
        </section>
      </div>
    </article>
  )
}

function DetailToolbar({ breadcrumb, title, onBack }: { readonly breadcrumb: string; readonly title: string; readonly onBack: () => void }): ReactElement {
  return <header className='ui26-vault-detail-toolbar'><button type='button' onClick={onBack}><ArrowLeft size={15} aria-hidden />Back to Vault</button><div><span>{breadcrumb}</span><h1 id='ui26-vault-detail-title'>{title}</h1></div></header>
}

function MissingVaultItem({ onBack }: { readonly onBack: () => void }): ReactElement {
  return <section className='ui26-vault-detail-missing' role='status'><FolderOpen size={24} aria-hidden /><h1>Vault item not found</h1><button type='button' onClick={onBack}>Back to Vault</button></section>
}
