import {
  Activity,
  Bell,
  Folder,
  KeyRound,
  Pin,
  Settings,
  Upload,
  Zap,
} from 'lucide-react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatRelativeDate } from '@/lib/date'
import {
  CompactRow,
  EnvBadge,
  QuickActionCard,
  SurfaceSectionHeader,
} from '../primitives.open'
import {
  DashboardComposition,
  DashboardMetricGrid,
  DashboardMetricItem,
  DashboardPanel,
  DashboardStatePanel,
} from '../primitives/dashboardComposition'
import type { createVaultSurfaceActions } from './vaultSurfaceActions.open'
import type {
  filterVaultSurfaceModel,
  searchVaultSurface,
  VaultSurfaceSecret,
} from './vaultSurfaceModel.open'
import type { VaultQuickAction } from './VaultSurface.open'
import { VaultSearchPanel } from './VaultSearchPanel.open'

type VisibleVault = ReturnType<typeof filterVaultSurfaceModel>
type VaultSearchResults = ReturnType<typeof searchVaultSurface>
type VaultActions = ReturnType<typeof createVaultSurfaceActions>

function SecretRow({
  secret,
  onActivate,
  reminder = false,
}: {
  readonly secret: VaultSurfaceSecret
  readonly onActivate: () => void
  readonly reminder?: boolean
}): ReactElement {
  return (
    <CompactRow
      icon={<KeyRound size={16} aria-hidden />}
      title={secret.name}
      meta={reminder && secret.reminderDueAt
        ? `${secret.type === 'certificate' ? 'Certificate expires' : 'Expires'} ${new Date(secret.reminderDueAt).toLocaleDateString()}`
        : formatRelativeDate(secret.timestamp)}
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
  additionalQuickAction,
  onboarding,
  onQueryChange,
  onSearchClose,
}: {
  readonly visible: VisibleVault
  readonly query: string
  readonly searchInput: RefObject<HTMLInputElement>
  readonly searchResults: VaultSearchResults
  readonly actions: VaultActions
  readonly additionalQuickAction?: VaultQuickAction
  readonly onboarding?: ReactNode
  readonly onQueryChange: (query: string) => void
  readonly onSearchClose: () => void
}): ReactElement {
  const pinnedCollections = visible.collections.filter((collection) => collection.pinned)
  const pinnedCount = visible.pinnedSecrets.length + pinnedCollections.length

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
      <DashboardComposition
        surface='vault'
        onboarding={onboarding}
        metrics={(
          <DashboardPanel title='Metrics' icon={<Activity size={15} />} count={visible.totalSecrets}>
            <DashboardMetricGrid label='Vault metrics'>
              <DashboardMetricItem label='Secrets' value={visible.totalSecrets} />
              <DashboardMetricItem label='Collections' value={visible.collectionCount} />
              <DashboardMetricItem label='Environments' value={visible.environments} />
              <DashboardMetricItem
                label='Reminders'
                value={visible.reminders.length}
                state={visible.reminders.length > 0 ? 'attention' : 'default'}
              />
            </DashboardMetricGrid>
          </DashboardPanel>
        )}
        pinned={(
          <Tabs defaultValue='secrets' className='ui26-vault-pinned-module'>
            <DashboardPanel
              panelId='pinned'
              title='Pinned'
              icon={<Pin size={15} />}
              count={pinnedCount}
              controls={(
                <TabsList className='ui26-vault-pinned-tablist' aria-label='Pinned Vault items'>
                  <TabsTrigger value='secrets'>
                    Pinned secrets <span>{visible.pinnedSecrets.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value='collections'>
                    Pinned collections <span>{pinnedCollections.length}</span>
                  </TabsTrigger>
                </TabsList>
              )}
            >
              <TabsContent value='secrets' className='ui26-vault-pinned-list'>
                {visible.pinnedSecrets.length ? visible.pinnedSecrets.map((secret) => (
                  <div className='ui26-vault-secret' key={secret.id}>
                    <strong>{secret.name}</strong>
                    <EnvBadge environment={secret.environment} compact />
                    <button
                      className='ui26-vault-row-action'
                      type='button'
                      aria-label={`Open ${secret.name}`}
                      onClick={() => actions.openSecret(secret)}
                    >
                      Open
                    </button>
                  </div>
                )) : <p className='ui26-muted'>No pinned secrets match this search.</p>}
              </TabsContent>
              <TabsContent value='collections' className='ui26-vault-pinned-list'>
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
                )) : <p className='ui26-muted'>No pinned collections.</p>}
              </TabsContent>
            </DashboardPanel>
          </Tabs>
        )}
        quickActions={(
          <>
            <SurfaceSectionHeader id='vault-quick-actions' title='Quick actions' icon={<Zap size={18} />} />
            <div className='ui26-vault-actions'>
              <QuickActionCard icon={<KeyRound size={24} aria-hidden />} title='Add secret' actionLabel='Add secret' tone='primary' onActivate={actions.openAddSecret} />
              <QuickActionCard icon={<Upload size={24} aria-hidden />} title='Import or export' actionLabel='Choose transfer flow' onActivate={actions.openImportOrExport} />
              <QuickActionCard icon={<Folder size={24} aria-hidden />} title='New collection' actionLabel='Create collection' onActivate={actions.openNewCollection} />
              {additionalQuickAction ? (
                <QuickActionCard
                  icon={additionalQuickAction.icon}
                  title={additionalQuickAction.title}
                  actionLabel={additionalQuickAction.actionLabel}
                  onActivate={additionalQuickAction.onActivate}
                />
              ) : (
                <QuickActionCard icon={<Settings size={24} aria-hidden />} title='Vault settings' actionLabel='Open settings' onActivate={actions.openVaultSettings} />
              )}
            </div>
          </>
        )}
        issues={(
          <DashboardStatePanel
            title='Issues / reminders'
            icon={<Bell size={15} />}
            count={visible.reminders.length}
            state={visible.reminders.length ? 'ready' : 'empty'}
            emptyMessage='Nothing needs attention.'
            viewAll
          >
            {visible.reminders.map((item) => (
              <SecretRow key={item.id} secret={item} reminder onActivate={() => actions.openSecret(item)} />
            ))}
          </DashboardStatePanel>
        )}
        activity={(
          <DashboardStatePanel
            title='General activity'
            icon={<KeyRound size={15} />}
            count={visible.recentSecrets.length}
            state={visible.recentSecrets.length ? 'ready' : 'empty'}
            emptyMessage='No recent secret updates.'
            viewAll
          >
            {visible.recentSecrets.map((item) => (
              <SecretRow key={item.id} secret={item} onActivate={() => actions.openSecret(item)} />
            ))}
          </DashboardStatePanel>
        )}
      />
    </div>
  )
}
