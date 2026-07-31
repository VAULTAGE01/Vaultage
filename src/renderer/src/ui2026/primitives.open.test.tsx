import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  EmptyFirst,
  EnvBadge,
  QuickActionCard,
  ScopedSearchTrigger,
  Ui2026Shell,
} from './primitives.open'

describe('Community UI2026 primitives', () => {
  it('keeps the shell landmarks and skip link stable', () => {
    const html = renderToStaticMarkup(
      <Ui2026Shell
        surface='vault'
        rail={<span>Vault context</span>}
        header={<span>Vault header</span>}
      >
        <span>Vault body</span>
      </Ui2026Shell>,
    )

    expect(html).toContain('href="#ui26-vault-surface"')
    expect(html).toContain('<aside')
    expect(html).toContain('aria-label="vault context"')
    expect(html).toContain('<main id="ui26-vault-surface"')
  })

  it('renders scoped search and local empty/action states accessibly', () => {
    const onOpen = vi.fn()
    const html = renderToStaticMarkup(
      <>
        <ScopedSearchTrigger
          scope='projects'
          placeholder='Search projects'
          onOpen={onOpen}
          triggerId='projects-search'
        />
        <EmptyFirst
          icon={<span aria-hidden>+</span>}
          title='No projects yet'
          description='Scan a local folder to begin.'
          primaryAction={{ label: 'Scan folder', onActivate: vi.fn() }}
        />
        <QuickActionCard
          icon={<span aria-hidden>+</span>}
          title='Scan local folder'
          description='Find environment keys.'
          actionLabel='Start'
          onActivate={vi.fn()}
        />
      </>,
    )

    expect(html).toContain('id="projects-search"')
    expect(html).toContain('aria-label="Search projects"')
    expect(html).toContain('No projects yet')
    expect(html).toContain('Scan local folder')
  })

  it('keeps full environment labels available to assistive technology', () => {
    const html = renderToStaticMarkup(
      <EnvBadge environment='staging' compact />,
    )

    expect(html).toContain('aria-label="Staging"')
    expect(html).toContain('>Stg</span>')
  })
})
