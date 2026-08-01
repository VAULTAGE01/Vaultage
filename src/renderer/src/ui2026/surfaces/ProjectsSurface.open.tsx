import { AlertCircle, CheckCircle2, FolderKanban, FolderSearch, Plus, Search, Settings2, Upload, Zap } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'
import {
  CompactRow,
  QuickActionCard,
  SurfaceSectionHeader,
  Ui2026Shell,
} from '../primitives.open'
import { SurfaceCommandHeader } from '../referenceComposition'
import type { EnvProject } from '@/types'
import {
  buildProjectsSurfaceModel,
  filterProjectsSearchEntries,
  projectsSearchEntries,
  type ProjectSurfaceSummary,
} from './projectsModel.open'
import './projectsSurface.open.css'

export type ProjectsSurfaceProps = {
  readonly projects: readonly EnvProject[]
  readonly onOpenExistingWorkspace: (projectId?: string) => void
  readonly onOpenNewProject: () => void
  readonly onOpenMappings: (projectId?: string | null) => void
  readonly onOpenExport: (projectId?: string | null) => void
}

export function ProjectsSurface({
  projects,
  onOpenExistingWorkspace,
  onOpenNewProject,
  onOpenMappings,
  onOpenExport,
}: ProjectsSurfaceProps): ReactElement {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const model = useMemo(() => buildProjectsSurfaceModel(projects), [projects])
  const searchResults = useMemo(
    () => filterProjectsSearchEntries(projectsSearchEntries(projects), searchQuery),
    [projects, searchQuery],
  )
  const selectedProject = model.projects[0]?.id
  const openMappings = (): void => onOpenMappings(selectedProject)
  const openExport = (): void => onOpenExport(selectedProject)
  const openProject = (projectId: string): void => {
    setSearchOpen(false)
    onOpenExistingWorkspace(projectId)
  }

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
          onSearch={() => setSearchOpen(true)}
          actions={[
            { label: 'New Project', onActivate: onOpenNewProject, icon: <Plus size={16} /> },
            { label: 'Manage mappings', onActivate: openMappings, variant: 'secondary', icon: <Settings2 size={16} /> },
          ]}
        />
      )}
    >
      <div className='ui26-projects-layout'>
        <section className='ui26-projects-action-section' aria-labelledby='projects-quick-actions'>
          <SurfaceSectionHeader id='projects-quick-actions' title='Quick actions' icon={<Zap size={18} />} />
          <div className='ui26-projects-actions'>
            <QuickActionCard icon={<FolderSearch size={24} />} title='Scan or import a local project' actionLabel='Open scanner' onActivate={onOpenNewProject} tone='primary' />
            <QuickActionCard icon={<Settings2 size={24} />} title='Manage mappings' actionLabel='Review keys' onActivate={openMappings} />
            <QuickActionCard icon={<Search size={24} />} title='Search projects' actionLabel='Find a project' onActivate={() => setSearchOpen(true)} />
            <QuickActionCard icon={<Upload size={24} />} title='Export .env' actionLabel='Review export' onActivate={openExport} disabledReason={model.projectCount === 0 ? 'Add a project before exporting.' : undefined} tone='warning' />
          </div>
        </section>

        <section className='ui26-projects-panels' aria-label='Local project overview'>
          <ProjectListPanel projects={model.projects} onOpenProject={openProject} />
          <ReadinessPanel projects={model.projects} onOpenProject={openProject} />
          <section className='ui26-projects-module'>
            <header><h2><Upload size={15} aria-hidden /> Recent exports</h2><span>{model.lastExportAt ? 'Tracked' : 'None'}</span></header>
            {model.lastExportAt ? (
              <p className='ui26-projects-summary'>The latest export is recorded on the project and can be reviewed from Manage mappings.</p>
            ) : (
              <div className='ui26-projects-empty'><strong>No exports yet</strong><span>Review mappings before writing a local .env file.</span></div>
            )}
            <button type='button' className='ui26-projects-module-action' onClick={openExport} disabled={model.projectCount === 0}>Review export</button>
          </section>
        </section>
      </div>

      {searchOpen ? (
        <div className='ui26-projects-search-backdrop' role='presentation' onMouseDown={() => setSearchOpen(false)}>
          <section className='ui26-projects-search-dialog' role='dialog' aria-modal='true' aria-labelledby='ui26-projects-search-label' onMouseDown={event => event.stopPropagation()}>
            <label id='ui26-projects-search-label' htmlFor='ui26-projects-search-input'>Search projects and mappings</label>
            <div className='ui26-projects-search-input'>
              <Search size={18} aria-hidden />
              <input id='ui26-projects-search-input' autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder='Project name, folder, or env key' />
              <button type='button' aria-label='Close project search' onClick={() => setSearchOpen(false)}>Close</button>
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

function ProjectListPanel({
  projects,
  onOpenProject,
}: {
  readonly projects: readonly ProjectSurfaceSummary[]
  readonly onOpenProject: (projectId: string) => void
}): ReactElement {
  return (
    <section className='ui26-projects-module'>
      <header><h2><FolderKanban size={15} aria-hidden /> Saved projects</h2><span>{projects.length}</span></header>
      {projects.length ? projects.map(project => (
        <CompactRow
          key={project.id}
          icon={<FolderKanban size={16} />}
          title={project.name}
          detail={project.path}
          meta={`${project.readyMappingCount}/${project.mappingCount}`}
          status={{ kind: project.status === 'Ready to export' || project.status.startsWith('Exported ') ? 'secure' : 'attention', label: project.status }}
          onActivate={() => onOpenProject(project.id)}
        />
      )) : <div className='ui26-projects-empty'><strong>No local projects yet</strong><span>Add your first project to start mapping Vault fields.</span></div>}
    </section>
  )
}

function ReadinessPanel({
  projects,
  onOpenProject,
}: {
  readonly projects: readonly ProjectSurfaceSummary[]
  readonly onOpenProject: (projectId: string) => void
}): ReactElement {
  const needsAttention = projects.filter(project => project.status !== 'Ready to export' && !project.status.startsWith('Exported '))
  return (
    <section className='ui26-projects-module'>
      <header><h2><AlertCircle size={15} aria-hidden /> Needs attention</h2><span>{needsAttention.length}</span></header>
      {needsAttention.length ? needsAttention.map(project => (
        <CompactRow key={project.id} icon={<AlertCircle size={16} />} title={project.name} detail={project.status} status={{ kind: 'attention', label: 'Review' }} onActivate={() => onOpenProject(project.id)} />
      )) : <div className='ui26-projects-empty'><strong>Everything is ready</strong><span>Saved projects have a local folder and complete mappings.</span></div>}
      {projects.length ? <p className='ui26-projects-readiness'><CheckCircle2 size={14} aria-hidden /> {projects.filter(project => project.status === 'Ready to export' || project.status.startsWith('Exported ')).length} ready of {projects.length}</p> : null}
    </section>
  )
}
