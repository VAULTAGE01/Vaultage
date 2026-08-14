import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DashboardComposition,
  DashboardStatePanel,
} from './dashboardComposition'

describe('DashboardComposition recovery', () => {
  it('replaces the metrics module with onboarding instead of stacking it', () => {
    const html = renderToStaticMarkup(
      <DashboardComposition
        surface='vault'
        metrics={<p>Metrics module</p>}
        pinned={<p>Pinned module</p>}
        quickActions={<p>Quick actions</p>}
        issues={<p>Issues</p>}
        activity={<p>Activity</p>}
        onboarding={<p>Setup checklist</p>}
      />,
    )

    expect(html).toContain('data-ui26-dashboard-slot="metrics"')
    expect(html).toContain('data-ui26-dashboard-slot-state="onboarding"')
    expect(html).toContain('Setup checklist')
    expect(html).not.toContain('Metrics module')
  })

  it('uses the shared panel wrapper for ready, empty, loading, and error modules', () => {
    const ready = renderToStaticMarkup(
      <DashboardStatePanel title='General activity' state='ready'>
        <p>Recent activity</p>
      </DashboardStatePanel>,
    )
    const empty = renderToStaticMarkup(
      <DashboardStatePanel title='Issues' state='empty' emptyMessage='Nothing needs attention.' />,
    )
    const loading = renderToStaticMarkup(
      <DashboardStatePanel title='Issues' state='loading' />,
    )
    const error = renderToStaticMarkup(
      <DashboardStatePanel
        title='Issues'
        state='error'
        error={{ message: 'Could not load issues.', recovery: 'Try again.' }}
      />,
    )

    for (const html of [ready, empty, loading, error]) {
      expect(html).toContain('class="ui26-dashboard-panel"')
      expect(html).not.toContain('class="ui26-dashboard-module"')
    }
    expect(ready).toContain('Recent activity')
    expect(empty).toContain('Nothing needs attention.')
    expect(loading).toContain('aria-busy="true"')
    expect(error).toContain('Could not load issues. Try again.')
  })

  it('offers a larger view for bounded activity modules', () => {
    const html = renderToStaticMarkup(
      <DashboardStatePanel title='General activity' state='ready' viewAll>
        <p>Recent activity</p>
      </DashboardStatePanel>,
    )

    expect(html).toContain('data-ui26-dashboard-view-all="General activity"')
    expect(html).toContain('View all')
  })
})
