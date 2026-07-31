import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useVault, flatSecrets } from '../vaultContext'
import { useMode } from '../modeContext.open'
import type { EnvProject } from '../types'
import EnvProjectsModal from './EnvProjectsModal'
import { Button } from '@/components/ui/button'
import { AlertCircle, ArrowLeft, CheckCircle2, FolderKanban, KeyRound, Plus, RefreshCw, Settings2 } from 'lucide-react'

function formatDate(value?: string): string {
  if (!value) return 'Never exported'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProjectsView() {
  const { state } = useVault()
  const { selectedProjectId, setSelectedProjectId } = useMode()
  const [projectModal, setProjectModal] = useState<{
    initialProjectId?: string | null
    startNew?: boolean
  } | null>(null)
  const projects = state.vault?.envProjects ?? []
  const secrets = useMemo(() => state.vault ? flatSecrets(state.vault.root) : [], [state.vault])
  const secretLabels = useMemo(
    () => new Map(secrets.map(({ secret, folderPath }) => [secret.id, `${folderPath} / ${secret.name}`])),
    [secrets],
  )
  const selectedProject = selectedProjectId
    ? projects.find(project => project.id === selectedProjectId) ?? null
    : null
  const mappingCount = projects.reduce((total, project) => total + project.entries.length, 0)
  const readyMappingCount = projects.reduce((total, project) => total + readyEntries(project).length, 0)
  const readyProjectCount = projects.filter(project => project.path && readyEntries(project).length > 0).length
  const needsAttention = projects.filter(project => !project.path || readyEntries(project).length < project.entries.length)
  const autoGitignoreCount = projects.filter(project => project.addToGitignore).length
  const lastExport = projects
    .map(project => project.lastExportAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  const openManager = (projectId?: string | null, startNew = false) => {
    setProjectModal({ initialProjectId: projectId ?? null, startNew })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="drag-region border-b border-border px-8 pb-5 pt-7">
        <div className="no-drag flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Projects</p>
            <h1 className="mt-1 text-2xl font-semibold text-text">
              {selectedProject ? selectedProject.name : 'Local Project Mappings'}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              {selectedProject
                ? selectedProject.path || 'Choose a local folder before exporting a .env file.'
                : 'Map Vault fields to local .env keys and export them only when you choose.'}
            </p>
          </div>
          {selectedProject ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSelectedProjectId(null)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Button>
              <Button onClick={() => openManager(selectedProject.id)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Manage
              </Button>
            </div>
          ) : (
            <Button onClick={() => openManager(null, true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden px-8 py-6">
        {selectedProject ? (
          <div className="h-full overflow-y-auto">
            <ProjectDetail
              project={selectedProject}
              secretLabels={secretLabels}
              onManage={() => openManager(selectedProject.id)}
            />
          </div>
        ) : (
          <div className="dashboard-grid max-w-none">
            <section className="dashboard-section">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Project overview</p>
              <div className="dashboard-metric-grid">
                <Metric title="Projects" value={projects.length} icon={<FolderKanban className="h-4 w-4" />} />
                <Metric title="Mapped Keys" value={mappingCount} icon={<KeyRound className="h-4 w-4" />} />
                <Metric title="Ready Keys" value={readyMappingCount} icon={<CheckCircle2 className="h-4 w-4" />} />
                <Metric title="Last Export" value={formatDate(lastExport)} icon={<RefreshCw className="h-4 w-4" />} />
                <Metric title="Needs Work" value={needsAttention.length} icon={<AlertCircle className="h-4 w-4" />} />
                <Metric title="Auto Ignore" value={autoGitignoreCount} icon={<CheckCircle2 className="h-4 w-4" />} />
              </div>
            </section>

            <section className="dashboard-bottom-grid">
              <div className="dashboard-section">
                <div className="flex items-center justify-between gap-3 px-1">
                  <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Saved Projects</h2>
                  {projects.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => openManager()}>
                      Manage
                    </Button>
                  )}
                </div>

                {projects.length === 0 ? (
                  <div className="dashboard-panel-card flex min-h-0 flex-col">
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
                      <p className="text-sm font-medium text-text">No projects yet</p>
                      <p className="mt-1 max-w-md text-xs text-muted">
                        Add a local project folder, map Vault fields to env keys, then export a plaintext .env file after confirmation.
                      </p>
                      <Button className="mt-4" onClick={() => openManager(null, true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Project
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="dashboard-panel-card flex min-h-0 flex-col">
                    <div className="dashboard-list">
                      <div className="grid gap-3 xl:grid-cols-2">
                        {projects.map(project => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            selected={selectedProjectId === project.id}
                            onOpen={() => setSelectedProjectId(project.id)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <aside className="dashboard-section">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Project Readiness</p>
                    <p className="mt-1 text-[10px] text-muted">
                      {readyProjectCount} of {projects.length} project{projects.length === 1 ? '' : 's'} can export at least one mapped key.
                    </p>
                  </div>
                  <FolderKanban className="h-4 w-4 text-muted" />
                </div>

                <div className="dashboard-panel-card flex min-h-0 flex-col">
                  <div className="dashboard-list">
                    {needsAttention.map(project => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => setSelectedProjectId(project.id)}
                        className="dashboard-list-row"
                      >
                        <p className="truncate text-xs font-medium text-text">{project.name}</p>
                        <p className="ml-auto truncate text-[10px] text-muted">{projectStatus(project)}</p>
                      </button>
                    ))}
                    {projects.length > 0 && needsAttention.length === 0 && (
                      <div className="dashboard-list-empty flex h-full items-center justify-center text-center">
                        <p className="px-4 text-xs text-muted">
                          All saved projects have a folder and complete mappings.
                        </p>
                      </div>
                    )}
                    {projects.length === 0 && (
                      <div className="dashboard-list-empty flex h-full items-center justify-center text-center">
                        <p className="px-4 text-xs text-muted">Create a project to start mapping env keys.</p>
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            </section>
          </div>
        )}
      </main>

      {projectModal && (
        <EnvProjectsModal
          initialProjectId={projectModal.initialProjectId}
          startNew={projectModal.startNew}
          onClose={() => setProjectModal(null)}
        />
      )}
    </div>
  )
}

function ProjectDetail({
  project,
  secretLabels,
  onManage,
}: {
  project: EnvProject
  secretLabels: Map<string, string>
  onManage: () => void
}) {
  const ready = readyEntries(project)
  const missing = project.entries.length - ready.length

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Metric title="Mappings" value={project.entries.length} icon={<KeyRound className="h-4 w-4" />} />
        <Metric title="Ready Keys" value={ready.length} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Metric title="Needs Work" value={missing} icon={<AlertCircle className="h-4 w-4" />} />
        <Metric title="Last Export" value={formatDate(project.lastExportAt)} icon={<RefreshCw className="h-4 w-4" />} />
        <Metric title="Auto Ignore" value={project.addToGitignore ? 'On' : 'Off'} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Metric title="Scan Files" value={project.manualScanFiles?.length ?? 0} icon={<FolderKanban className="h-4 w-4" />} />
      </div>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Env Mappings</h2>
            <Button variant="outline" size="sm" onClick={onManage}>
              Manage
            </Button>
          </div>

          {project.entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-black/10 px-6 py-10 text-center">
              <p className="text-sm font-medium text-text">No mappings yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                Add env keys and connect them to vault fields before exporting.
              </p>
              <Button className="mt-4" onClick={onManage}>
                <Plus className="mr-2 h-4 w-4" />
                Add Mapping
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {project.entries.map((entry, index) => {
                const ready = Boolean(entry.envKey && entry.secretId && entry.fieldKey)
                return (
                  <div
                    key={`${entry.envKey}-${entry.secretId}-${entry.fieldKey}-${index}`}
                    className="grid gap-3 border-b border-border px-4 py-3 text-xs last:border-b-0 md:grid-cols-[180px_1fr_120px]"
                  >
                    <p className="min-w-0 truncate font-mono font-medium text-text">{entry.envKey || 'UNNAMED_KEY'}</p>
                    <p className="min-w-0 truncate text-text-secondary">
                      {entry.secretId ? secretLabels.get(entry.secretId) ?? 'Missing secret' : 'No secret selected'}
                      {entry.fieldKey ? ` / ${entry.fieldKey}` : ''}
                    </p>
                    <p className={cn('flex items-center gap-1 text-[10px] font-semibold', ready ? 'text-emerald-400' : 'text-muted')}>
                      {ready ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      {ready ? 'Ready' : 'Incomplete'}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text">Export Target</p>
          <p className="mt-2 break-words rounded-lg border border-border bg-black/10 px-3 py-2 font-mono text-[11px] text-text-secondary">
            {project.path || 'No folder selected'}
          </p>
          <div className="mt-4 space-y-2 text-xs text-muted">
            <p>{project.addToGitignore ? '.env will be added to .gitignore.' : '.gitignore update is disabled.'}</p>
            <p>{ready.length} key{ready.length === 1 ? '' : 's'} ready for the next export.</p>
          </div>
          <Button className="mt-4 w-full" onClick={onManage}>
            <Settings2 className="mr-2 h-4 w-4" />
            Manage Export
          </Button>
        </aside>
      </section>
    </>
  )
}

function ProjectCard({
  project,
  selected,
  onOpen,
}: {
  project: EnvProject
  selected: boolean
  onOpen: () => void
}) {
  const ready = readyEntries(project).length
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'rounded-xl border bg-surface p-4 text-left transition-colors',
        selected ? 'border-accent/50' : 'border-border hover:border-white/[0.16]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{project.name}</p>
          <p className="mt-1 truncate text-[11px] text-muted">{project.path || 'No folder linked'}</p>
        </div>
        <span className="rounded-lg border border-border bg-black/20 px-2 py-1 text-[10px] font-semibold text-text-secondary">
          {ready}/{project.entries.length}
        </span>
      </div>
      <p className="mt-3 text-[11px] text-muted">{projectStatus(project)}</p>
    </button>
  )
}

function readyEntries(project: EnvProject) {
  return project.entries.filter(entry => entry.envKey && entry.secretId && entry.fieldKey)
}

function projectStatus(project: EnvProject): string {
  if (!project.path) return 'Needs a local folder'
  const ready = readyEntries(project).length
  if (project.entries.length === 0) return 'Needs env mappings'
  if (ready < project.entries.length) return `${ready}/${project.entries.length} mappings ready`
  return project.lastExportAt ? `Exported ${formatDate(project.lastExportAt)}` : 'Ready to export'
}

function Metric({ title, value, icon }: { title: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between text-muted">
        <p className="text-[10px] font-semibold uppercase tracking-wider">{title}</p>
        {icon}
      </div>
      <p className="mt-2 text-xl font-semibold text-text">{value}</p>
    </div>
  )
}
