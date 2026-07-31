import { Folder } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Ui2026Surface } from '../flags'
import { ReferenceRail } from '../referenceComposition'
import { ContextRail, EnvBadge, type ActionSpec } from '../primitives'
import type { filterVaultSurfaceModel } from './vaultSurfaceModel.open'

type VisibleVault = ReturnType<typeof filterVaultSurfaceModel>

export function VaultReferenceRail({
  visible,
  workspaceAction,
  onSearch,
  onSurfaceChange,
}: {
  readonly visible: VisibleVault | null
  readonly workspaceAction?: ActionSpec
  readonly onSearch: () => void
  readonly onSurfaceChange: (surface: Ui2026Surface) => void
}): ReactElement {
  return (
    <ReferenceRail
      surface='vault'
      searchPlaceholder='Search secrets and collections'
      onSearch={onSearch}
      onSurfaceChange={onSurfaceChange}
    >
      <ContextRail
        title='My Vault'
        description='Encrypted local storage'
        primaryAction={workspaceAction}
        stats={visible
          ? [
              { label: 'Secrets', value: visible.totalSecrets },
              { label: 'Collections', value: visible.collectionCount },
            ]
          : []}
        footer={<span className='ui26-vault-rail-note'>Vault settings</span>}
      >
        {visible?.typeGroups.length ? (
          visible.typeGroups.map((group) => (
            <div className='ui26-vault-rail-group' key={group.type}>
              <div className='ui26-vault-rail-heading'>
                <span>{group.type}</span>
                <span>{group.count}</span>
              </div>
              {group.environments.map(({ environment, count }) => (
                <div className='ui26-vault-rail-env' key={environment}>
                  <Folder size={14} aria-hidden />
                  <EnvBadge environment={environment} compact />
                  <span>{count}</span>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className='ui26-vault-empty'>
            No types or environments match this search.
          </div>
        )}
      </ContextRail>
    </ReferenceRail>
  )
}
