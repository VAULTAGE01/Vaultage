import type { ReactElement, ReactNode } from 'react'
import { ActionButton } from './rows'
import type { ActionSpec } from './types'

export function EmptyFirst({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  evidence = [],
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly description: string
  readonly primaryAction?: ActionSpec
  readonly secondaryAction?: ActionSpec
  readonly evidence?: readonly {
    readonly label: string
    readonly detail: string
  }[]
}): ReactElement {
  return (
    <section className='ui26-state'>
      <span className='ui26-icon'>{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {evidence.map((item) => (
        <p key={item.label} className='ui26-muted'>
          {item.label}: {item.detail}
        </p>
      ))}
      {primaryAction ? <ActionButton action={primaryAction} /> : null}
      {secondaryAction ? (
        <ActionButton action={secondaryAction} secondary />
      ) : null}
    </section>
  )
}

export function QuickActionCard({
  icon,
  title,
  description,
  actionLabel,
  tone = 'neutral',
  onActivate,
  disabledReason,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly description?: string
  readonly actionLabel: string
  readonly tone?: 'primary' | 'neutral' | 'info' | 'warning'
  readonly onActivate: () => void
  readonly disabledReason?: string
}): ReactElement {
  const disabled = Boolean(disabledReason)
  const reasonId = 'ui26-'
    + title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')
    + '-reason'
  return (
    <button
      type='button'
      className={'ui26-quick-action ui26-quick-action-' + tone}
      disabled={disabled}
      onClick={onActivate}
      aria-describedby={disabled ? reasonId : undefined}
    >
      <span className='ui26-icon'>{icon}</span>
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
        {disabledReason ? (
          <small id={reasonId}>{disabledReason}</small>
        ) : (
          <em>{actionLabel}</em>
        )}
      </span>
    </button>
  )
}
