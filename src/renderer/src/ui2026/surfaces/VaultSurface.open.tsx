import { LockKeyhole, Plus, Upload } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useVault } from '../../vaultContext'
import type { Ui2026Surface } from '../flags'
import { EmptyFirst, Ui2026Shell } from '../primitives'
import type { ActionSpec } from '../primitives'
import { SurfaceCommandHeader } from '../referenceComposition'
import { VaultDashboard } from './VaultDashboard.open'
import { VaultReferenceRail } from './VaultReferenceRail.open'
import { VaultSearchPanel } from './VaultSearchPanel.open'
import {
  createVaultSurfaceActions,
  type VaultLegacyWorkspaceView,
} from './vaultSurfaceActions.open'
import {
  buildVaultSurfaceModel,
  filterVaultSurfaceModel,
  searchVaultSurface,
} from './vaultSurfaceModel.open'
import './VaultSurface.open.css'

export type VaultSurfaceProps = {
  readonly onSurfaceChange: (surface: Ui2026Surface) => void
  readonly rail?: ReactNode
  readonly embedded?: boolean
  readonly onOpenLegacyWorkspace?: (view: VaultLegacyWorkspaceView) => void
}

export function VaultSurface({
  onSurfaceChange,
  onOpenLegacyWorkspace,
  rail: railOverride,
  embedded = false,
}: VaultSurfaceProps): ReactElement {
  const { state, selectFolder, selectSecret } = useVault()
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const model = state.vault ? buildVaultSurfaceModel(state.vault) : null
  const actions = useMemo(
    () => createVaultSurfaceActions({
      selectFolder,
      selectSecret,
      onOpenLegacyWorkspace,
    }),
    [onOpenLegacyWorkspace, selectFolder, selectSecret],
  )
  const workspaceAction: ActionSpec | undefined = onOpenLegacyWorkspace
    ? {
        label: 'Open existing Vault workspace',
        onActivate: actions.openWorkspace,
      }
    : undefined
  const visible = useMemo(
    () => (model ? filterVaultSurfaceModel(model, query) : null),
    [model, query],
  )
  const searchResults = useMemo(
    () => (model ? searchVaultSurface(model, query) : []),
    [model, query],
  )
  const openSearch = (): void => setQuery((current) => current || ' ')

  useEffect(() => {
    if (query) searchInput.current?.focus()
  }, [query])

  const commandHeader = (
    <SurfaceCommandHeader
      title='Vault'
      scope='vault'
      searchPlaceholder='Search secrets, collections, or tags'
      searchTriggerId='ui26-vault-search-trigger-header'
      onSearch={openSearch}
      actions={workspaceAction ? [
        {
          label: 'Add secret',
          onActivate: actions.openWorkspace,
          icon: <Plus size={16} aria-hidden />,
        },
        {
          label: 'Import or export',
          onActivate: actions.openWorkspace,
          variant: 'secondary',
          icon: <Upload size={16} aria-hidden />,
        },
      ] : []}
    />
  )
  const referenceRail = embedded ? undefined : (
    <VaultReferenceRail
      visible={visible}
      workspaceAction={workspaceAction}
      onSearch={openSearch}
      onSurfaceChange={onSurfaceChange}
    />
  )
  const rail = railOverride ?? referenceRail

  if (!visible || visible.totalSecrets === 0) {
    return (
      <Ui2026Shell
        surface='vault'
        rail={rail}
        header={commandHeader}
        embedded={embedded}
      >
        <div className='ui26-vault-empty-layout'>
          <VaultSearchPanel
            query={query}
            searchInput={searchInput}
            searchResults={searchResults}
            actions={actions}
            onQueryChange={setQuery}
            onClose={() => setQuery('')}
          />
          <EmptyFirst
            icon={<LockKeyhole size={24} aria-hidden />}
            title='Start your secure vault'
            description='Add or import your first secret. It stays encrypted on this device.'
            primaryAction={workspaceAction}
            evidence={[
              {
                label: 'Storage',
                detail: 'Encrypted locally on this device',
              },
            ]}
          />
        </div>
      </Ui2026Shell>
    )
  }

  return (
    <Ui2026Shell
      surface='vault'
      rail={rail}
      header={commandHeader}
      embedded={embedded}
    >
      <VaultDashboard
        visible={visible}
        query={query}
        searchInput={searchInput}
        searchResults={searchResults}
        actions={actions}
        onQueryChange={setQuery}
        onSearchClose={() => setQuery('')}
      />
    </Ui2026Shell>
  )
}

export default VaultSurface
