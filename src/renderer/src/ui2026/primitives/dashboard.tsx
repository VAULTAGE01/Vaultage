import type { ReactElement, ReactNode } from 'react'

export type DashboardModuleState = 'ready' | 'loading' | 'empty' | 'error'

export type DashboardModuleProps = {
  readonly title: string
  readonly icon?: ReactNode
  readonly count?: number
  readonly state?: DashboardModuleState
  readonly emptyMessage?: string
  readonly error?: {
    readonly message: string
    readonly recovery: string
  }
  readonly className?: string
  readonly children?: ReactNode
}

function assertNever(value: never): never {
  throw new Error(`Unexpected dashboard module state: ${value}`)
}

export function renderDashboardModuleState(
  state: DashboardModuleState,
  title: string,
  emptyMessage: string,
  error: DashboardModuleProps['error'],
  children: ReactNode,
): ReactNode {
  switch (state) {
    case 'ready':
      return children
    case 'loading':
      return (
        <div className='ui26-dashboard-module-state is-loading' aria-busy='true' aria-live='polite'>
          <span className='ui26-row-skeleton' aria-label={`Loading ${title}`} />
        </div>
      )
    case 'empty':
      return (
        <p className='ui26-dashboard-module-state is-empty' role='status'>
          {emptyMessage}
        </p>
      )
    case 'error':
      return (
        <p className='ui26-dashboard-module-state is-error' role='alert'>
          {error?.message ?? 'Could not load this module.'} {error?.recovery ?? 'Try again later.'}
        </p>
      )
    default:
      return assertNever(state)
  }
}

export function DashboardModule({
  title,
  icon,
  count,
  state = 'ready',
  emptyMessage = 'Nothing to show yet.',
  error,
  className,
  children,
}: DashboardModuleProps): ReactElement {
  const moduleClassName = `ui26-dashboard-module${className ? ` ${className}` : ''}`

  return (
    <section className={moduleClassName} data-ui26-dashboard-module-state={state}>
      <header>
        <h2>
          {icon ? <span className='ui26-dashboard-module-icon' aria-hidden>{icon}</span> : null}
          {title}
        </h2>
        {count === undefined ? null : <span aria-label={`${count} items`}>{count}</span>}
      </header>
      <div className='ui26-dashboard-module-body'>
        {renderDashboardModuleState(state, title, emptyMessage, error, children)}
      </div>
    </section>
  )
}
