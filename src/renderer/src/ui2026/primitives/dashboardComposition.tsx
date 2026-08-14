import { useState, type ReactElement, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import {
  renderDashboardModuleState,
  type DashboardModuleProps,
  type DashboardModuleState,
} from './dashboard'
import type { DashboardSurface } from './dashboardOnboardingModel'
import './dashboardComposition.css'

export type DashboardCompositionProps = {
  readonly surface: DashboardSurface
  readonly metrics: ReactNode
  readonly pinned: ReactNode
  readonly quickActions: ReactNode
  readonly issues: ReactNode
  readonly activity: ReactNode
  readonly onboarding?: ReactNode
}

export type DashboardPanelProps = {
  readonly title: string
  readonly className?: string
  readonly icon?: ReactNode
  readonly count?: number
  readonly controls?: ReactNode
  readonly panelId?: string
  readonly children: ReactNode
  readonly state?: DashboardModuleState
}

export type DashboardStatePanelProps = Omit<DashboardModuleProps, 'className'> & {
  readonly viewAll?: boolean
}

export type DashboardMetricGridProps = {
  readonly label: string
  readonly children: ReactNode
}

export type DashboardMetricItemProps = {
  readonly label: string
  readonly value: string | number
  readonly icon?: ReactNode
  readonly detail?: string
  readonly state?: 'default' | 'attention'
}

export function DashboardPanel({
  title,
  className,
  icon,
  count,
  controls,
  panelId,
  children,
  state = 'ready',
}: DashboardPanelProps): ReactElement {
  return (
    <section
      className={`ui26-dashboard-panel${className ? ` ${className}` : ''}`}
      data-ui26-dashboard-panel={panelId}
      data-ui26-dashboard-panel-state={state}
    >
      <header className='ui26-dashboard-panel-header'>
        <div className='ui26-dashboard-panel-title'>
          {icon ? <span className='ui26-dashboard-panel-icon' aria-hidden>{icon}</span> : null}
          <h2>{title}</h2>
        </div>
        {count === undefined && !controls ? null : (
          <div className='ui26-dashboard-panel-meta'>
            {count === undefined ? null : (
              <span className='ui26-dashboard-panel-count' aria-label={`${count} items`}>
                {count}
              </span>
            )}
            {controls ? <div className='ui26-dashboard-panel-controls'>{controls}</div> : null}
          </div>
        )}
      </header>
      <div className='ui26-dashboard-panel-body'>{children}</div>
    </section>
  )
}

export function DashboardStatePanel({
  title,
  icon,
  count,
  state = 'ready',
  emptyMessage = 'Nothing to show yet.',
  error,
  children,
  viewAll = false,
}: DashboardStatePanelProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const content = renderDashboardModuleState(state, title, emptyMessage, error, children)
  return (
    <>
      <DashboardPanel
        title={title}
        icon={icon}
        count={count}
        state={state}
        controls={viewAll ? (
          <button
            type='button'
            className='ui26-dashboard-view-all'
            data-ui26-dashboard-view-all={title}
            onClick={() => setExpanded(true)}
          >
            View all
          </button>
        ) : undefined}
      >
        {content}
      </DashboardPanel>
      {viewAll ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className='ui26-dashboard-view-all-dialog'>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <div className='ui26-dashboard-view-all-content'>{content}</div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

export function DashboardMetricGrid({
  label,
  children,
}: DashboardMetricGridProps): ReactElement {
  return (
    <dl className='ui26-dashboard-metric-grid' aria-label={label}>
      {children}
    </dl>
  )
}

export function DashboardMetricItem({
  label,
  value,
  icon,
  detail,
  state = 'default',
}: DashboardMetricItemProps): ReactElement {
  const className = `ui26-dashboard-metric-item${state === 'attention' ? ' is-attention' : ''}`
  return (
    <div className={className} data-ui26-metric-state={state}>
      {icon ? <span className='ui26-dashboard-metric-icon' aria-hidden>{icon}</span> : null}
      <dt>{label}</dt>
      <dd>{value}</dd>
      {state === 'attention' ? <span className='ui26-dashboard-metric-attention'>Needs attention</span> : null}
      {detail ? <p>{detail}</p> : null}
    </div>
  )
}

export function DashboardComposition({
  surface,
  metrics,
  pinned,
  quickActions,
  issues,
  activity,
  onboarding,
}: DashboardCompositionProps): ReactElement {
  return (
    <div className='ui26-dashboard-composition' data-ui26-dashboard-surface={surface}>
      <div className='ui26-dashboard-overview' data-ui26-dashboard-row='overview'>
        <div
          className='ui26-dashboard-metrics-slot'
          data-ui26-dashboard-slot='metrics'
          data-ui26-dashboard-slot-state={onboarding ? 'onboarding' : 'metrics'}
        >
          {onboarding ? (
            <div className='ui26-dashboard-onboarding-card' data-ui26-dashboard-onboarding-card>
              {onboarding}
            </div>
          ) : metrics}
        </div>
        <div className='ui26-dashboard-pinned-slot' data-ui26-dashboard-slot='pinned'>
          {pinned}
        </div>
      </div>

      <section
        className='ui26-dashboard-quick-actions-slot'
        data-ui26-dashboard-row='quick-actions'
        data-ui26-dashboard-slot='quick-actions'
        aria-label={`${surface === 'vault' ? 'Vault' : 'Projects'} quick actions`}
      >
        {quickActions}
      </section>

      <div className='ui26-dashboard-issues-activity' data-ui26-dashboard-row='issues-activity'>
        <div className='ui26-dashboard-issues-slot' data-ui26-dashboard-slot='issues'>
          {issues}
        </div>
        <div className='ui26-dashboard-activity-slot' data-ui26-dashboard-slot='activity'>
          {activity}
        </div>
      </div>
    </div>
  )
}
