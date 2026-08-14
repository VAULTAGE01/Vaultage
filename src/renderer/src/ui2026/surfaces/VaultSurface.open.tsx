import { LockKeyhole, Plus, Upload } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type ComponentType,
} from 'react'
import { useVault } from '../../vaultContext'
import SecretDetail from '../../components/SecretDetail.open'
import type { Ui2026Surface } from '../flags'
import { EmptyFirst, Ui2026Shell } from '../primitives.open'
import type { ActionSpec } from '../primitives.open'
import { SurfaceCommandHeader } from '../referenceComposition'
import { DashboardOnboarding } from '../primitives/dashboardOnboarding'
import {
  readDashboardOnboardingSessionDismissal,
  readDashboardOnboardingSkip,
  writeDashboardOnboardingSessionDismissal,
  writeDashboardOnboardingSkip,
  type DashboardOnboardingState,
  type DashboardOnboardingStorage,
} from '../primitives/dashboardOnboardingModel'
import { VaultDashboard } from './VaultDashboard.open'
import { VaultDetailWorkspace } from './VaultDetailWorkspace.open'
import { VaultReferenceRail } from './VaultReferenceRail.open'
import { VaultSearchPanel } from './VaultSearchPanel.open'
import {
  createVaultSurfaceActions,
  type VaultDetailTarget,
  type VaultWorkflow,
} from './vaultSurfaceActions.open'
import { VaultWorkflowDialogs } from './VaultWorkflowDialogs.open'
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
  readonly renderSecretDetail?: () => ReactNode
  readonly addSecretModal?: ComponentType<{ readonly folderId: string, readonly onClose: () => void }>
  readonly additionalQuickAction?: VaultQuickAction
}

export type VaultQuickAction = {
  readonly icon: ReactNode
  readonly title: string
  readonly actionLabel: string
  readonly onActivate: () => void
}

export function VaultSurface({
  onSurfaceChange,
  renderSecretDetail,
  rail: railOverride,
  embedded = false,
  addSecretModal,
  additionalQuickAction,
}: VaultSurfaceProps): ReactElement {
  const { state, selectFolder, selectSecret } = useVault()
  const [query, setQuery] = useState('')
  const [detailTarget, setDetailTarget] = useState<VaultDetailTarget | null>(null)
  const [workflow, setWorkflow] = useState<VaultWorkflow | null>(null)
  const [onboardingHidden, setOnboardingHidden] = useState(() => (
    readDashboardOnboardingSkip(browserStorage(), 'vault').skipped
    || readDashboardOnboardingSessionDismissal(browserSessionStorage(), 'vault').dismissed
  ))
  const searchInput = useRef<HTMLInputElement>(null)
  const model = state.vault ? buildVaultSurfaceModel(state.vault) : null
  const onboardingState: DashboardOnboardingState = {
    surface: 'vault',
    completed: model
      ? model.totalSecrets > 0
        ? ['vault-ready', 'first-secret-added']
        : ['vault-ready']
      : [],
  }
  const openDetail = useCallback((target: VaultDetailTarget): void => {
    setQuery('')
    setDetailTarget(target)
  }, [])
  const closeDetail = useCallback((): void => {
    selectSecret(null)
    setDetailTarget(null)
  }, [selectSecret])
  const actions = useMemo(
    () => createVaultSurfaceActions({
      selectFolder,
      selectSecret,
      onOpenDetail: openDetail,
      onOpenWorkflow: setWorkflow,
    }),
    [openDetail, selectFolder, selectSecret],
  )
  const addSecretAction: ActionSpec = {
    label: 'Add secret',
    onActivate: actions.openAddSecret,
  }
  const visible = useMemo(
    () => (model ? filterVaultSurfaceModel(model, query) : null),
    [model, query],
  )
  const searchResults = useMemo(
    () => (model ? searchVaultSurface(model, query) : []),
    [model, query],
  )
  const openSearch = (): void => setQuery((current) => current || ' ')
  const skipOnboarding = (): void => {
    const storageWrite = writeDashboardOnboardingSkip(browserStorage(), 'vault')
    if (storageWrite.kind === 'stored') setOnboardingHidden(true)
  }
  const closeOnboarding = (): void => {
    writeDashboardOnboardingSessionDismissal(browserSessionStorage(), 'vault')
    setOnboardingHidden(true)
  }

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
      actions={[
        {
          label: 'Add secret',
          onActivate: actions.openAddSecret,
          icon: <Plus size={16} aria-hidden />,
        },
        {
          label: 'Import or export',
          onActivate: actions.openImportOrExport,
          variant: 'secondary',
          icon: <Upload size={16} aria-hidden />,
        },
      ]}
    />
  )
  const referenceRail = embedded ? undefined : (
    <VaultReferenceRail
      visible={visible}
      primaryAction={addSecretAction}
      hasActiveSearch={query.length > 0}
      onSearch={openSearch}
      onSurfaceChange={onSurfaceChange}
    />
  )
  const rail = railOverride ?? referenceRail

  const dashboardContent = !visible ? (
        <div className='ui26-vault-empty-layout'>
          {query ? (
            <VaultSearchPanel
              query={query}
              searchInput={searchInput}
              searchResults={searchResults}
              actions={actions}
              onQueryChange={setQuery}
              onClose={() => setQuery('')}
            />
          ) : null}
          <EmptyFirst
            icon={<LockKeyhole size={24} aria-hidden />}
            title='Start your secure vault'
            description='Add or import your first secret. It stays encrypted on this device.'
            primaryAction={addSecretAction}
            evidence={[
              {
                label: 'Storage',
                detail: 'Encrypted locally on this device',
              },
            ]}
          />
        </div>
  ) : (
    <VaultDashboard
      visible={visible}
      query={query}
      searchInput={searchInput}
      searchResults={searchResults}
      actions={actions}
      additionalQuickAction={additionalQuickAction}
      onboarding={onboardingHidden ? null : (
        <DashboardOnboarding
          state={onboardingState}
          onClose={closeOnboarding}
          onSkip={skipOnboarding}
        />
      )}
      onQueryChange={setQuery}
      onSearchClose={() => setQuery('')}
    />
  )
  const content = detailTarget ? (
    <VaultDetailWorkspace
      target={detailTarget}
      onBack={closeDetail}
      onOpenSecret={actions.openSecretSelection}
      secretDetail={detailTarget.kind === 'secret'
        ? renderSecretDetail?.() ?? <SecretDetail emptyState='folder' />
        : null}
    />
  ) : dashboardContent

  return (
    <Ui2026Shell
      surface='vault'
      rail={rail}
      header={commandHeader}
      embedded={embedded}
    >
      {content}
      <VaultWorkflowDialogs
        workflow={workflow}
        onClose={() => setWorkflow(null)}
        addSecretModal={addSecretModal}
      />
    </Ui2026Shell>
  )
}

function browserStorage(): DashboardOnboardingStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function browserSessionStorage(): DashboardOnboardingStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

export default VaultSurface
