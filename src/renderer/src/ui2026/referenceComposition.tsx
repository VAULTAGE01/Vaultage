import { LockKeyhole, Search, Zap } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import type { Ui2026Surface } from './flags'
import {
  ActionButton,
  ScopedSearchTrigger,
  type ActionSpec,
} from './primitives'
import { SurfaceSwitcher } from './surfaceNavigation'

type ReferenceRailProps = {
  readonly surface: Ui2026Surface
  readonly servicesAvailable?: boolean
  readonly searchPlaceholder: string
  readonly searchTriggerId?: string
  readonly onSearch: () => void
  readonly onSurfaceChange: (surface: Ui2026Surface) => void
  readonly children: ReactNode
}

export function ReferenceRail({
  surface,
  servicesAvailable = false,
  searchPlaceholder,
  searchTriggerId,
  onSearch,
  onSurfaceChange,
  children,
}: ReferenceRailProps): ReactElement {
  return (
    <div className='ui26-reference-rail'>
      <div className='ui26-brand'>
        <span className='ui26-brand-mark' aria-hidden>
          <Zap size={22} strokeWidth={2.25} />
        </span>
        <strong>Vaultage</strong>
        <LockKeyhole size={16} aria-label='Encrypted local vault storage' />
      </div>
      <SurfaceSwitcher
        value={surface}
        available={{ vault: true, projects: true, services: servicesAvailable }}
        onValueChange={onSurfaceChange}
      />
      <ScopedSearchTrigger
        scope={surface}
        placeholder={searchPlaceholder}
        onOpen={onSearch}
        triggerId={searchTriggerId}
        variant='rail'
      />
      <div className='ui26-reference-rail-context'>{children}</div>
    </div>
  )
}

type SurfaceCommandHeaderProps = {
  readonly title: string
  readonly scope: Ui2026Surface
  readonly searchPlaceholder: string
  readonly onSearch: () => void
  readonly searchTriggerId?: string
  readonly actions?: readonly ActionSpec[]
}

export function SurfaceCommandHeader({
  title,
  scope,
  searchPlaceholder,
  onSearch,
  searchTriggerId,
  actions = [],
}: SurfaceCommandHeaderProps): ReactElement {
  return (
    <div className='ui26-command-header'>
      <h1>{title}</h1>
      <div className='ui26-command-search'>
        <Search size={16} aria-hidden />
        <ScopedSearchTrigger
          scope={scope}
          placeholder={searchPlaceholder}
          onOpen={onSearch}
          triggerId={searchTriggerId}
        />
      </div>
      <div className='ui26-command-actions'>
        {actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      </div>
    </div>
  )
}
