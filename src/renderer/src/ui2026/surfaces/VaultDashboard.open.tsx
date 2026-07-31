import {
  Bell,
  Folder,
  Globe2,
  KeyRound,
  Pin,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import type { ReactElement, RefObject } from 'react'
import { formatRelativeDate } from '@/lib/date'
import {
  CompactRow,
  EnvBadge,
  QuickActionCard,
  SurfaceSectionHeader,
} from '../primitives'
import type { createVaultSurfaceActions } from './vaultSurfaceActions.open'
import type {
  filterVaultSurfaceModel,
  searchVaultSurface,
  VaultSurfaceSecret,
} from './vaultSurfaceModel.open'
import { VaultSearchPanel } from './VaultSearchPanel.open'

type VisibleVault = ReturnType<typeof filterVaultSurfaceModel>
type VaultSearchResults = ReturnType<typeof searchVaultSurface>
type VaultActions = ReturnType<typeof createVaultSurfaceActions>

function SecretRow({
  secret,
  onActivate,
}: {
  readonly secret: VaultSurfaceSecret
  readonly onActivate: () => void
}): ReactElement {
  return (
    <CompactRow
      icon={<KeyRound size={16} aria-hidden />}
      title={secret.name}
      meta={formatRelativeDate(secret.timestamp)}
      onActivate={onActivate}
    />
  )
}

export function VaultDashboard({
  visible,
  query,
  searchInput,
  searchResults,
  actions,
  onQueryChange,
  onSearchClose,
}: {
  readonly visible: VisibleVault
  readonly query: string
  readonly searchInput: RefObject<HTMLInputElement>
  readonly searchResults: VaultSearchResults
  readonly actions: VaultActions
  readonly onQueryChange: (query: string) => void
  readonly onSearchClose: () => void
}): ReactElement {
  const pinnedCollections = visible.collections.filter((collection) => collection.pinned)
  const metrics = [
    { label: 'Secrets', value: visible.totalSecrets, icon: <KeyRound size={20} /> },
    { label: 'Collections', value: visible.collectionCount, icon: <Folder size={20} /> },
    { label: 'Environments', value: visible.environments, icon: <Globe2 size={20} /> },
    { label: 'Pinned', value: visible.pinnedSecrets.length, icon: <Pin size={20} /> },
    { label: 'Reminders', value: visible.reminders.length, icon: <Bell size={20} /> },
    { label: 'Storage', value: 'Local', icon: <ShieldCheck size={20} /> },
  ] as const

  return (
    <div className='ui26-vault-layout'>
      {query ? (
        <VaultSearchPanel
          query={query}
          searchInput={searchInput}
          searchResults={searchResults}
          actions={actions}
          onQueryChange={onQueryChange}
          onClose={onSearchClose}
        />
      ) : null}
      <section className='ui26-vault-summary' aria-label='Vault overview'>
        <div className='ui26-vault-metrics' aria-label='Vault metrics'>
          {metrics.map((metric) => (
            <div className='ui26-vault-metric' key={metric.label}>
              <i aria-hidden>{metric.icon}</i>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
        <section className='ui26-vault-pinned'>
          <div className='ui26-vault-pinned-heading'>
            <h2><Pin size={15} aria-hidden /> Pinned secrets</h2>
            <span>{visible.pinnedSecrets.length}</span>
          </div>
          <div className='ui26-vault-pinned-list'>
            {visible.pinnedSecrets.length ? visible.pinnedSecrets.map((secret) => (
              <div className='ui26-vault-secret' key={secret.id}>
                <strong>{secret.name}</strong>
                <EnvBadge environment={secret.environment} compact />
                <button
                  className='ui26-vault-row-action'
                  type='button'
                  onClick={() => actions.openSecret(secret)}
                >
                  Open
                </button>
              </div>
            )) : <p className='ui26-muted'>No pinned secrets match this search.</p>}
          </div>
        </section>
      </section>
      <section className='ui26-vault-action-section' aria-labelledby='vault-quick-actions'>
        <SurfaceSectionHeader id='vault-quick-actions' title='Quick actions' />
        <div className='ui26-grid ui26-vault-actions'>
          <QuickActionCard
            icon={<KeyRound size={28} aria-hidden />}
            title='Add secret'
            actionLabel='Open workspace'
            tone='primary'
            onActivate={actions.openWorkspace}
          />
          <QuickActionCard
            icon={<Upload size={28} aria-hidden />}
            title='Import or export'
            actionLabel='Open workspace'
            onActivate={actions.openWorkspace}
          />
          <QuickActionCard
            icon={<Folder size={28} aria-hidden />}
            title='New collection'
            actionLabel='Open workspace'
            onActivate={actions.openWorkspace}
          />
          <QuickActionCard
            icon={<Settings size={28} aria-hidden />}
            title='Vault settings'
            actionLabel='Open workspace'
            onActivate={actions.openWorkspace}
          />
        </div>
      </section>
      <section className='ui26-vault-bottom' aria-label='Vault updates'>
        <section className='ui26-vault-module'>
          <header>
            <h2><Bell size={15} aria-hidden /> Reminders</h2>
            <span>{visible.reminders.length}</span>
          </header>
          {visible.reminders.length ? visible.reminders.map((item) => (
            <SecretRow
              key={item.id}
              secret={item}
              onActivate={() => actions.openSecret(item)}
            />
          )) : <p className='ui26-vault-empty-line'>Nothing needs attention.</p>}
        </section>
        <section className='ui26-vault-module'>
          <header>
            <h2><KeyRound size={15} aria-hidden /> Recent secrets</h2>
            <span>{visible.recentSecrets.length}</span>
          </header>
          {visible.recentSecrets.length ? visible.recentSecrets.map((item) => (
            <SecretRow
              key={item.id}
              secret={item}
              onActivate={() => actions.openSecret(item)}
            />
          )) : <p className='ui26-vault-empty-line'>No recent secret updates.</p>}
        </section>
        <section className='ui26-vault-module'>
          <header>
            <h2><Folder size={15} aria-hidden /> Pinned collections</h2>
            <span>{pinnedCollections.length}</span>
          </header>
          {pinnedCollections.length ? pinnedCollections.map((collection) => (
            <button
              className='ui26-vault-collection'
              type='button'
              key={collection.id}
              onClick={() => actions.openCollection(collection)}
            >
              <strong>{collection.name}</strong>
              <span>{collection.count} secrets</span>
            </button>
          )) : <p className='ui26-vault-empty-line'>No pinned collections.</p>}
        </section>
      </section>
    </div>
  )
}
