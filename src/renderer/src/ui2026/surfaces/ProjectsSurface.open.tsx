import { FolderSearch, Link2, Plus, Search, Settings2, Upload, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  QuickActionCard,
  SurfaceSectionHeader,
  Ui2026Shell,
} from '../primitives.open'
import { DashboardComposition } from '../primitives/dashboardComposition'
import { DashboardOnboarding } from '../primitives/dashboardOnboarding'
import {
  readDashboardOnboardingSessionDismissal,
  readDashboardOnboardingSkip,
  writeDashboardOnboardingSessionDismissal,
  writeDashboardOnboardingSkip,
  type DashboardOnboardingStorage,
} from '../primitives/dashboardOnboardingModel'
import { SurfaceCommandHeader } from '../referenceComposition'
import type { EnvProject } from '@/types'
import {
  buildProjectsSurfaceModel,
  filterProjectsSearchEntries,
  projectsSearchEntries,
} from './projectsModel.open'
import {
  ProjectActivityModule,
  ProjectIssuesModule,
  ProjectMetricsPanel,
  ProjectPinnedPanel,
} from './ProjectsDashboardModules.open'
import { projectsOnboardingState } from './projectsOnboarding.open'
import './projectsSurface.open.css'

export type ProjectsSurfaceProps = {
  readonly projects: readonly EnvProject[]
  readonly pinnedProjectIds?: readonly string[]
  readonly additionalQuickAction?: ProjectQuickAction
  readonly onOpenExistingWorkspace: (projectId?: string) => void
  readonly onOpenNewProject: () => void
  readonly onOpenMappings: (projectId?: string | null) => void
  readonly onOpenExport: (projectId?: string | null) => void
}

export type ProjectQuickAction = {
  readonly icon: ReactNode
  readonly title: string
  readonly actionLabel: string
  readonly onActivate: () => void
}

const EMPTY_PINNED_PROJECT_IDS: readonly string[] = []

export function ProjectsSurface({
  projects,
  pinnedProjectIds = EMPTY_PINNED_PROJECT_IDS,
  additionalQuickAction,
  onOpenExistingWorkspace,
  onOpenNewProject,
  onOpenMappings,
  onOpenExport,
}: ProjectsSurfaceProps): ReactElement {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchDialogRef = useRef<HTMLElement>(null)
  const searchReturnFocusRef = useRef<HTMLElement | null>(null)
  const [onboardingHidden, setOnboardingHidden] = useState(() => (
    readDashboardOnboardingSkip(browserStorage(), 'projects').skipped
    || readDashboardOnboardingSessionDismissal(browserSessionStorage(), 'projects').dismissed
  ))
  const model = useMemo(
    () => buildProjectsSurfaceModel(projects, pinnedProjectIds),
    [pinnedProjectIds, projects],
  )
  const onboardingState = useMemo(() => projectsOnboardingState(projects), [projects])
  const searchResults = useMemo(
    () => filterProjectsSearchEntries(projectsSearchEntries(projects), searchQuery),
    [projects, searchQuery],
  )
  const selectedProject = model.projects[0]?.id
  const openProjectWorkspace = (): void => {
    if (selectedProject) onOpenExistingWorkspace(selectedProject)
    else onOpenNewProject()
  }
  const openMappings = (): void => {
    if (selectedProject) onOpenMappings(selectedProject)
    else onOpenNewProject()
  }
  const openExport = (): void => onOpenExport(selectedProject)
  const openSearch = (): void => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      searchReturnFocusRef.current = document.activeElement
    }
    setSearchOpen(true)
  }
  const closeSearch = (): void => setSearchOpen(false)
  const openProject = (projectId: string): void => {
    closeSearch()
    onOpenExistingWorkspace(projectId)
  }
  const skipOnboarding = (): void => {
    const storageWrite = writeDashboardOnboardingSkip(browserStorage(), 'projects')
    if (storageWrite.kind === 'stored') setOnboardingHidden(true)
  }
  const closeOnboarding = (): void => {
    writeDashboardOnboardingSessionDismissal(browserSessionStorage(), 'projects')
    setOnboardingHidden(true)
  }

  useEffect(() => {
    if (!searchOpen) {
      const returnFocus = searchReturnFocusRef.current
      searchReturnFocusRef.current = null
      if (returnFocus?.isConnected) returnFocus.focus()
      return
    }

    const dialog = searchDialogRef.current
    if (!dialog) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        const edge = event.shiftKey ? last : first
        edge.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [searchOpen])

  return (
    <Ui2026Shell
      surface='projects'
      embedded
      header={(
        <SurfaceCommandHeader
          title='Projects'
          scope='projects'
          searchPlaceholder='Search projects and mappings'
          searchTriggerId='ui26-projects-search-trigger-header'
          onSearch={openSearch}
          actions={[
            { label: 'New Project', onActivate: onOpenNewProject, icon: <Plus size={16} /> },
            { label: 'Manage mappings', onActivate: openMappings, variant: 'secondary', icon: <Settings2 size={16} /> },
          ]}
        />
      )}
    >
      <div className='ui26-projects-layout'>
        <DashboardComposition
          surface='projects'
          metrics={<ProjectMetricsPanel model={model} />}
          pinned={<ProjectPinnedPanel projects={model.pinnedProjects} onOpenProject={openProject} />}
          onboarding={onboardingHidden ? null : (
            <DashboardOnboarding
              state={onboardingState}
              onClose={closeOnboarding}
              onSkip={skipOnboarding}
            />
          )}
          quickActions={(
            <>
              <SurfaceSectionHeader id='projects-quick-actions' title='Quick actions' icon={<Zap size={18} />} />
              <div className='ui26-projects-actions'>
                <QuickActionCard icon={<FolderSearch size={24} />} title='Scan/import local project' actionLabel='Open scanner' onActivate={onOpenNewProject} tone='primary' />
                {additionalQuickAction ? (
                  <QuickActionCard
                    icon={additionalQuickAction.icon}
                    title={additionalQuickAction.title}
                    actionLabel={additionalQuickAction.actionLabel}
                    onActivate={additionalQuickAction.onActivate}
                  />
                ) : null}
                <QuickActionCard icon={<Settings2 size={24} />} title='Manage mapping' actionLabel='Open project' onActivate={openProjectWorkspace} />
                <QuickActionCard icon={<Upload size={24} />} title='Review export' actionLabel='Review export' onActivate={openExport} disabledReason={model.projectCount === 0 ? 'Add a project before exporting.' : undefined} tone='warning' />
                <QuickActionCard icon={<Link2 size={24} />} title='Link vault secrets' actionLabel='Choose secrets' onActivate={openMappings} />
              </div>
            </>
          )}
          issues={<ProjectIssuesModule projects={model.needsAttentionProjects} onOpenProject={openProject} />}
          activity={<ProjectActivityModule activity={model.activity} onOpenProject={openProject} />}
        />
      </div>

      {searchOpen ? (
        <div className='ui26-projects-search-backdrop' role='presentation' onMouseDown={() => setSearchOpen(false)}>
          <section ref={searchDialogRef} className='ui26-projects-search-dialog' role='dialog' aria-modal='true' aria-labelledby='ui26-projects-search-label' onMouseDown={event => event.stopPropagation()}>
            <label id='ui26-projects-search-label' htmlFor='ui26-projects-search-input'>Search projects and mappings</label>
            <div className='ui26-projects-search-input'>
              <Search size={18} aria-hidden />
              <input id='ui26-projects-search-input' autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder='Project name, folder, or env key' />
              <button type='button' aria-label='Close project search' onClick={closeSearch}>Close</button>
            </div>
            <p className='ui26-muted' aria-live='polite'>{searchResults.length} result{searchResults.length === 1 ? '' : 's'}</p>
            <div className='ui26-projects-search-results'>
              {searchResults.map(result => (
                <button key={result.id} type='button' onClick={() => openProject(result.projectId)}>
                  <strong>{result.title}</strong>
                  <span>{result.detail}</span>
                  <em>{result.kind}</em>
                </button>
              ))}
              {searchResults.length === 0 ? <p>No local project or mapping matches this search.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </Ui2026Shell>
  )
}

function browserStorage(): DashboardOnboardingStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function browserSessionStorage(): DashboardOnboardingStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}
