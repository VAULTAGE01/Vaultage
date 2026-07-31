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

describe('ProjectsView Community dashboard', () => {
  it('keeps the dashboard pane bounded and presents the empty saved-project action without a nested empty card', () => {
    envProjects = []
    const html = renderToStaticMarkup(<ProjectsView />)

    expect(html).toContain('min-h-0 flex-1 overflow-hidden px-8 py-6')
    expect(html).not.toContain('overflow-y-auto')
    expect(html).not.toContain('border-dashed')
    expect(html).not.toContain('Turn a local folder into a reviewed .env export')
    expect(html).toContain('Add Project')
  })

  it('puts all saved-project and readiness rows in internal dashboard lists', () => {
    envProjects = Array.from({ length: 6 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${index}`,
      path: '',
      entries: [],
      addToGitignore: false,
    }))

    const html = renderToStaticMarkup(<ProjectsView />)

    expect(html.match(/class="dashboard-list"/g)).toHaveLength(2)
    expect(html.match(/class="dashboard-list-row"/g)).toHaveLength(6)
  })
})
