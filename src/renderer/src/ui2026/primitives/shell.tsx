import { Search } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Ui2026Surface } from '../flags'

const SURFACES = [
  'vault',
  'projects',
  'services',
] as const satisfies readonly Ui2026Surface[]

export function nextAvailableSurface(
  current: Ui2026Surface,
  available: Readonly<Record<Ui2026Surface, boolean>>,
  direction: 1 | -1,
): Ui2026Surface {
  const enabled = SURFACES.filter((surface) => available[surface])
  const currentIndex = enabled.indexOf(current)
  if (enabled.length === 0 || currentIndex === -1) return current
  return (
    enabled[(currentIndex + direction + enabled.length) % enabled.length] ??
    current
  )
}

export function ScopedSearchTrigger({
  scope,
  placeholder,
  onOpen,
  triggerId,
  variant = 'header',
}: {
  readonly scope: Ui2026Surface
  readonly placeholder: string
  readonly onOpen: () => void
  readonly triggerId?: string
  readonly variant?: 'header' | 'rail'
}): ReactElement {
  return (
    <button
      type='button'
      id={triggerId}
      className={cn('ui26-search', variant === 'rail' && 'is-rail')}
      onClick={onOpen}
      aria-label={'Search ' + scope}
    >
      {variant === 'rail' ? <Search size={16} aria-hidden /> : null}
      <span>{placeholder}</span>
      {variant === 'header' ? <kbd>⌘K</kbd> : null}
    </button>
  )
}

export function Ui2026Shell({
  surface,
  rail,
  header,
  embedded = false,
  children,
}: {
  readonly surface: Ui2026Surface
  readonly rail?: ReactNode
  readonly header?: ReactNode
  readonly embedded?: boolean
  readonly children: ReactNode
}): ReactElement {
  const mainId = 'ui26-' + surface + '-surface'
  const workspace = (
    <section className={cn('ui26-workspace', !header && 'is-headerless')}>
      {header ? <header className='ui26-header'>{header}</header> : null}
      <main id={mainId} className='ui26-main' tabIndex={-1}>
        {children}
      </main>
    </section>
  )

  if (embedded) {
    return (
      <div className='ui26-shell is-embedded' data-ui2026-surface={surface}>
        <a className='ui26-skip' href={'#' + mainId}>
          Skip to content
        </a>
        {workspace}
      </div>
    )
  }

  return (
    <div
      className='ui26-shell liquid-shell'
      data-ui2026-surface={surface}
    >
      <a className='ui26-skip' href={'#' + mainId}>
        Skip to content
      </a>
      <aside
        className='ui26-rail liquid-sidebar bg-sidebar'
        aria-label={surface + ' context'}
      >
        {rail}
      </aside>
      {workspace}
    </div>
  )
}
