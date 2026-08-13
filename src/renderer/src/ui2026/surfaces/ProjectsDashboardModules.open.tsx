import { AlertCircle, Activity, FolderKanban, Pin, Upload } from 'lucide-react'
import type { ReactElement } from 'react'
import { CompactRow } from '../primitives.open'
import {
  DashboardMetricGrid,
  DashboardMetricItem,
  DashboardPanel,
  DashboardStatePanel,
} from '../primitives/dashboardComposition'
import type {
  ProjectActivity,
  ProjectSurfaceSummary,
  ProjectsSurfaceModel,
} from './projectsModel.open'

export type ProjectMetricsPanelProps = {
  readonly model: ProjectsSurfaceModel
}

export function ProjectMetricsPanel({
  model,
}: ProjectMetricsPanelProps): ReactElement {
  return (
    <DashboardPanel title='Metrics' icon={<Activity size={15} />} count={model.projectCount}>
      <DashboardMetricGrid label='Project metrics'>
        <DashboardMetricItem label='Projects' value={model.projectCount} />
        <DashboardMetricItem label='Mapped keys' value={model.mappingCount} />
        <DashboardMetricItem label='Ready keys' value={model.readyMappingCount} />
        <DashboardMetricItem
          label='Needs work'
          value={model.needsAttentionCount}
          state={model.needsAttentionCount > 0 ? 'attention' : 'default'}
        />
      </DashboardMetricGrid>
    </DashboardPanel>
  )
}

export type ProjectPinnedPanelProps = {
  readonly projects: readonly ProjectSurfaceSummary[]
  readonly onOpenProject: (projectId: string) => void
}

export function ProjectPinnedPanel({
  projects,
  onOpenProject,
}: ProjectPinnedPanelProps): ReactElement {
  return (
    <DashboardPanel title='Pinned projects' icon={<Pin size={15} />} count={projects.length}>
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
      )) : (
        <div className='ui26-projects-empty'>
          <strong>No pinned projects yet</strong>
          <span>Pin a project from its detail view to keep it in this dashboard module.</span>
        </div>
      )}
    </DashboardPanel>
  )
}

export type ProjectIssuesModuleProps = {
  readonly projects: readonly ProjectSurfaceSummary[]
  readonly onOpenProject: (projectId: string) => void
}

export function ProjectIssuesModule({
  projects,
  onOpenProject,
}: ProjectIssuesModuleProps): ReactElement {
  return (
    <DashboardStatePanel
      title='Issues / reminders'
      icon={<AlertCircle size={15} />}
      count={projects.length}
      state={projects.length ? 'ready' : 'empty'}
      emptyMessage='Everything is ready. No project issues need attention.'
    >
      {projects.map(project => (
        <CompactRow key={project.id} icon={<AlertCircle size={16} />} title={project.name} detail={project.status} status={{ kind: 'attention', label: 'Review' }} onActivate={() => onOpenProject(project.id)} />
      ))}
    </DashboardStatePanel>
  )
}

export type ProjectActivityModuleProps = {
  readonly activity: readonly ProjectActivity[]
  readonly onOpenProject: (projectId: string) => void
}

export function ProjectActivityModule({
  activity,
  onOpenProject,
}: ProjectActivityModuleProps): ReactElement {
  return (
    <DashboardStatePanel
      title='General activity'
      icon={<Upload size={15} />}
      count={activity.length}
      state={activity.length ? 'ready' : 'empty'}
      emptyMessage='No recent project activity.'
    >
      {activity.map(item => (
        <CompactRow key={item.id} icon={<Upload size={16} />} title={item.title} detail={item.detail} onActivate={() => onOpenProject(item.projectId)} />
      ))}
    </DashboardStatePanel>
  )
}
