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
    expect(html).toContain('No local projects yet')
    expect(html).not.toContain('Turn a local folder into a reviewed .env export')
    expect(html).not.toMatch(/Services|Agent|provider|billing|cloud environment/i)
  })

  it('keeps saved projects and readiness rows inside the UI2026 modules', () => {
    envProjects = Array.from({ length: 6 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${index}`,
      path: '',
      entries: [],
      addToGitignore: false,
    }))

    const html = renderToStaticMarkup(<ProjectsView />)

    expect(html.match(/class="ui26-projects-module"/g)).toHaveLength(3)
    expect(html.match(/Project \d/g)).toHaveLength(12)
    expect(html).toContain('Saved projects')
    expect(html).toContain('Needs attention')
  })
})
