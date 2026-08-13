import { ArrowRight, Check, Circle } from 'lucide-react'
import { useId } from 'react'
import type { ReactElement } from 'react'
import {
  resolveDashboardOnboardingProgress,
  type DashboardOnboardingState,
} from './dashboardOnboardingModel'
import './dashboardComposition.css'

export type DashboardOnboardingProps = {
  readonly state: DashboardOnboardingState
  readonly onClose: () => void
  readonly onSkip: () => void
}

export function DashboardOnboarding({
  state,
  onClose,
  onSkip,
}: DashboardOnboardingProps): ReactElement {
  const titleId = useId()
  const progress = resolveDashboardOnboardingProgress(state)
  const surfaceLabel = progress.surface === 'vault' ? 'Vault' : 'Projects'
  const isComplete = progress.nextStep === null

  return (
    <aside
      className='ui26-dashboard-onboarding'
      data-ui26-onboarding-tone={progress.surface}
      aria-labelledby={titleId}
    >
      <div className='ui26-dashboard-onboarding-copy'>
        <p className='ui26-dashboard-onboarding-eyebrow'>Setup checklist</p>
        <h2 id={titleId}>{isComplete ? `${surfaceLabel} setup complete` : `Finish ${surfaceLabel} setup`}</h2>
        <p>{isComplete ? 'This workspace is ready.' : `Next: ${progress.nextStep.label}`}</p>
      </div>

      <div className='ui26-dashboard-onboarding-progress'>
        <div className='ui26-dashboard-onboarding-summary'>
          <span>{progress.completedCount} of {progress.milestones.length} complete</span>
          <progress
            value={progress.completedCount}
            max={progress.milestones.length}
            aria-label={`${surfaceLabel} setup progress: ${progress.completedCount} of ${progress.milestones.length} complete`}
          />
        </div>
        <ol className='ui26-dashboard-onboarding-checklist'>
          {progress.milestones.map((milestone) => {
            const status = milestone.completed
              ? 'complete'
              : milestone.id === progress.nextStep?.id
                ? 'current'
                : 'later'
            const statusLabel = status === 'complete'
              ? 'Completed'
              : status === 'current'
                ? 'Next step'
                : 'Later'

            return (
              <li
                key={milestone.id}
                data-step-status={status}
                aria-label={`${statusLabel}: ${milestone.label}`}
              >
                <span className='ui26-dashboard-onboarding-step-mark' aria-hidden>
                  {status === 'complete' ? <Check size={13} /> : status === 'current' ? <ArrowRight size={13} /> : <Circle size={10} />}
                </span>
                <span className='ui26-dashboard-onboarding-step-copy'>
                  <strong>{milestone.label}</strong>
                  <small aria-hidden>{statusLabel}</small>
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className='ui26-dashboard-onboarding-actions'>
        <button
          type='button'
          className='ui26-dashboard-onboarding-close'
          aria-label={`Close ${surfaceLabel} setup for this session`}
          onClick={onClose}
        >
          Close
        </button>
        <button
          type='button'
          aria-label={`Skip ${surfaceLabel} setup permanently`}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </aside>
  )
}
