import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EnvProject } from '@/types'
import { ProjectsSurface } from './ProjectsSurface.open'

const projects: readonly EnvProject[] = [{
  id: 'api',
  name: 'API service',
  path: '/work/api',
  entries: [{ envKey: 'API_KEY', secretId: 'secret-1', fieldKey: 'value' }],
  addToGitignore: true,
}]

describe('Community UI2026 Projects surface', () => {
  it('renders local project actions and keeps closed product actions out of the open surface', () => {
    const html = renderToStaticMarkup(
      <ProjectsSurface
        projects={projects}
        onOpenExistingWorkspace={() => undefined}
        onOpenNewProject={() => undefined}
        onOpenMappings={() => undefined}
        onOpenExport={() => undefined}
      />,
    )

    expect(html).toContain('class="ui26-shell is-embedded"')
    expect(html).toContain('Projects')
    expect(html).toContain('Scan/import local project')
    expect(html).toContain('Manage mapping')
    expect(html).not.toContain('Review export')
    expect(html).not.toContain('<em>Choose secrets</em>')
    expect(html.match(/class="ui26-quick-action/g)).toHaveLength(2)
    expect(html).toContain('data-ui26-dashboard-surface="projects"')
    expect(html).toContain('data-ui26-dashboard-slot-state="onboarding"')
    expect(html).toContain('Projects setup complete')
    expect(html).toContain('Pinned projects')
    expect(html).toContain('Issues / reminders')
    expect(html).toContain('General activity')
    expect(html).not.toContain('Saved projects')
    expect(html).not.toContain('ui26-projects-hero-shell')
    expect(html).not.toContain('Keep local projects and Vault mappings in sync')
    expect(html).not.toContain('Dismiss project guidance')
    expect(html).not.toMatch(/Services|Agent|provider|billing|cloud environment/i)
  })

  it('keeps the empty state actionable without changing the existing modal contract', () => {
    const html = renderToStaticMarkup(
      <ProjectsSurface
        projects={[]}
        onOpenExistingWorkspace={() => undefined}
        onOpenNewProject={() => undefined}
        onOpenMappings={() => undefined}
        onOpenExport={() => undefined}
      />,
    )

    expect(html).toContain('No pinned projects yet')
    expect(html).toContain('Pin a project from its detail view')
    expect(html).toContain('Scan/import local project')
    expect(html).toContain('Manage mapping')
    expect(html).not.toContain('Review export')
    expect(html).not.toContain('<em>Choose secrets</em>')
    expect(html).not.toContain('overflow-y-auto')
  })
})
