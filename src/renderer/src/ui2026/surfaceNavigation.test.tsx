import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  markPendingSurfaceFocus,
  pendingSurfaceFocusMatches,
  SurfaceSwitcher,
  surfaceControlId,
  takePendingSurfaceFocus,
} from './surfaceNavigation'

describe('Community UI2026 surface navigation', () => {
  it('renders only available Vault and Projects controls in Community', () => {
    const html = renderToStaticMarkup(
      <SurfaceSwitcher
        value='vault'
        available={{ vault: true, projects: true, services: false }}
        onValueChange={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="Surface navigation"')
    expect(html).toContain('id="ui26-surface-control-vault"')
    expect(html).toContain('id="ui26-surface-control-projects"')
    expect(html).not.toContain('Services')
  })

  it('can preserve unavailable controls for a closed composition', () => {
    const html = renderToStaticMarkup(
      <SurfaceSwitcher
        value='vault'
        available={{ vault: true, projects: true, services: false }}
        onValueChange={vi.fn()}
        showUnavailable
      />,
    )

    expect(html).toContain('id="ui26-surface-control-services"')
    expect(html).toContain('disabled=""')
  })

  it('keeps focus intent scoped to the target surface and TTL', () => {
    markPendingSurfaceFocus('projects', 100)
    expect(pendingSurfaceFocusMatches('vault', 200)).toBe(false)
    expect(takePendingSurfaceFocus('projects', 200)).toBe(true)
    expect(takePendingSurfaceFocus('projects', 200)).toBe(false)

    markPendingSurfaceFocus('projects', 100)
    expect(pendingSurfaceFocusMatches('projects', 1_601)).toBe(false)
    expect(surfaceControlId('projects')).toBe('ui26-surface-control-projects')
  })
})
