import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EnvProject } from '../types'

let envProjects: EnvProject[] = []

vi.mock('../vaultContext', () => ({
  flatSecrets: () => [],
  useVault: () => ({ state: { vault: { envProjects, root: {} } } }),
}))

vi.mock('../modeContext.open', () => ({
  useMode: () => ({ selectedProjectId: null, setSelectedProjectId: vi.fn() }),
}))

vi.mock('./EnvProjectsModal', () => ({
  default: () => null,
}))

import ProjectsView from './ProjectsView.open'

describe('ProjectsView Community Projects surface', () => {
  it('renders the open UI2026 surface with a bounded scroll owner and actionable empty state', () => {
    envProjects = []
    const html = renderToStaticMarkup(<ProjectsView />)

    expect(html).toContain('class="ui26-shell is-embedded"')
    expect(html).toContain('Scan/import local project')
    expect(html).toContain('No pinned projects yet')
    expect(html).toContain('Finish Projects setup')
    expect(html).not.toContain('Turn a local folder into a reviewed .env export')
    expect(html).not.toMatch(/Services|Agent|provider|billing|cloud environment/i)
  })

  it('keeps project attention rows inside the same shared panels as metrics and pinned projects', () => {
    envProjects = Array.from({ length: 6 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${index}`,
      path: '',
      entries: [],
      addToGitignore: false,
    }))

    const html = renderToStaticMarkup(<ProjectsView />)

    expect(html.match(/class="ui26-dashboard-panel"/g)).toHaveLength(3)
    expect(html).not.toContain('ui26-projects-module')
    expect(html.match(/Project \d/g)).toHaveLength(6)
    expect(html).toContain('Pinned projects')
    expect(html).toContain('Issues / reminders')
    expect(html).toContain('Needs a local folder')
  })
})
