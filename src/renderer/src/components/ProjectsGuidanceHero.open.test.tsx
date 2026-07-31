import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CommunityProjectsGuidanceHero } from './ProjectsGuidanceHero.open'

describe('CommunityProjectsGuidanceHero', () => {
  it('describes the real local scan-map-export flow and dismisses locally', () => {
    const onDismiss = vi.fn()
    const html = renderToStaticMarkup(
      <CommunityProjectsGuidanceHero onDismiss={onDismiss} />,
    )

    expect(html).toContain('Turn a local folder into a reviewed .env export')
    expect(html).toContain('Scan a local folder')
    expect(html).toContain('Map Vault fields')
    expect(html).toContain('Confirm every export')
    const visibleCopy = html.replace(/<[^>]+>/gu, ' ')
    expect(visibleCopy).not.toMatch(/agent|cloud|provider|service/i)
  })
})
