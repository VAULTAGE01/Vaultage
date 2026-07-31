import type { ReactElement, ReactNode } from 'react'
import { ActionButton } from './rows'
import type { ActionSpec } from './types'

export function ContextRail({
  title,
  description,
  primaryAction,
  icon,
  stats = [],
  children,
  footer,
}: {
  readonly title: string
  readonly description?: string
  readonly primaryAction?: ActionSpec
  readonly icon?: ReactNode
  readonly stats?: readonly {
    readonly label: string
    readonly value: string | number
  }[]
  readonly children: ReactNode
  readonly footer?: ReactNode
}): ReactElement {
  return (
    <div className='ui26-rail-content'>
      <div className='ui26-rail-promo'>
        {icon ? (
          <span className='ui26-rail-promo-icon' aria-hidden>
            {icon}
          </span>
        ) : null}
        <h2>{title}</h2>
        {description ? <p className='ui26-muted'>{description}</p> : null}
        {primaryAction ? <ActionButton action={primaryAction} /> : null}
      </div>
      {stats.length > 0 ? <RailStatSplit stats={stats} /> : null}
      <div className='ui26-rail-tree'>{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </div>
  )
}

export function RailStatSplit({
  stats,
}: {
  readonly stats: readonly {
    readonly label: string
    readonly value: string | number
  }[]
}): ReactElement {
  return (
    <div className='ui26-stats'>
      {stats.map((stat) => (
        <div key={stat.label}>
          <strong>{stat.value}</strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </div>
  )
}

export function RailSection({
  title,
  action,
  children,
}: {
  readonly title: string
  readonly action?: ActionSpec
  readonly children: ReactNode
}): ReactElement {
  return (
    <section className='ui26-rail-section'>
      <header>
        <h3>{title}</h3>
        {action ? (
          <button
            type='button'
            className='ui26-rail-section-action'
            disabled={action.disabled}
            onClick={action.onActivate}
          >
            {action.icon ? (
              <span className='ui26-icon' aria-hidden>
                {action.icon}
              </span>
            ) : null}
            {action.label}
          </button>
        ) : null}
      </header>
      {children}
    </section>
  )
}
