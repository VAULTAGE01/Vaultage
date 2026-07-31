import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useVault, flatSecrets } from '../vaultContext'
import { useMode } from '../modeContext.open'
import type { EnvProject } from '../types'
import EnvProjectsModal from './EnvProjectsModal'
import { ProjectsSurface } from '../ui2026/surfaces/ProjectsSurface'
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
  const openManager = (projectId?: string | null, startNew = false) => {
    setProjectModal({ initialProjectId: projectId ?? null, startNew })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {selectedProject ? <header className="drag-region border-b border-border px-8 pb-5 pt-7">
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
      </header> : null}

      <main className={selectedProject ? 'min-h-0 flex-1 overflow-hidden px-8 py-6' : 'min-h-0 flex-1 overflow-hidden'}>
        {selectedProject ? (
          <div className="h-full overflow-y-auto">
            <ProjectDetail
              project={selectedProject}
              secretLabels={secretLabels}
              onManage={() => openManager(selectedProject.id)}
            />
          </div>
        ) : (
          <ProjectsSurface
            projects={projects}
            onOpenExistingWorkspace={(projectId) => setSelectedProjectId(projectId ?? null)}
            onOpenNewProject={() => openManager(null, true)}
            onOpenMappings={(projectId) => openManager(projectId)}
            onOpenExport={(projectId) => openManager(projectId)}
          />
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

function readyEntries(project: EnvProject) {
  return project.entries.filter(entry => entry.envKey && entry.secretId && entry.fieldKey)
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
