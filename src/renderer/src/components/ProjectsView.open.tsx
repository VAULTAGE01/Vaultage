import { useState } from 'react'
import type { ReactNode } from 'react'
import { useVault } from '../vaultContext'
import { useMode } from '../modeContext.open'
import EnvProjectsModal from './EnvProjectsModal'
import { Button } from '@/components/ui/button'
import { FolderKanban, KeyRound, Plus, RefreshCw } from 'lucide-react'

function formatDate(value?: string): string {
  if (!value) return 'Never exported'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProjectsView() {
  const { state } = useVault()
  const { selectedProjectId, setSelectedProjectId } = useMode()
  const [manageOpen, setManageOpen] = useState(false)
  const projects = state.vault?.envProjects ?? []
  const mappingCount = projects.reduce((total, project) => total + project.entries.length, 0)
  const lastExport = projects
    .map(project => project.lastExportAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  const openManager = (projectId?: string) => {
    setSelectedProjectId(projectId ?? null)
    setManageOpen(true)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="drag-region border-b border-border px-8 pb-5 pt-7">
        <div className="no-drag flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Projects</p>
            <h1 className="mt-1 text-2xl font-semibold text-text">Local Project Mappings</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Map vault fields to local `.env` keys and export them only when you choose.
            </p>
          </div>
          <Button onClick={() => openManager('new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric title="Projects" value={projects.length} icon={<FolderKanban className="h-4 w-4" />} />
          <Metric title="Mapped Keys" value={mappingCount} icon={<KeyRound className="h-4 w-4" />} />
          <Metric title="Last Export" value={formatDate(lastExport)} icon={<RefreshCw className="h-4 w-4" />} />
        </div>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Saved Projects</h2>
            {projects.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => openManager()}>
                Manage
              </Button>
            )}
          </div>

          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-black/10 px-6 py-10 text-center">
              <p className="text-sm font-medium text-text">No projects yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                Add a local project folder, map vault fields to env keys, then export a plaintext `.env` file after confirmation.
              </p>
              <Button className="mt-4" onClick={() => openManager('new')}>
                <Plus className="mr-2 h-4 w-4" />
                Add Project
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => openManager(project.id)}
                  className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-white/[0.16]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">{project.name}</p>
                      <p className="mt-1 truncate text-[11px] text-muted">{project.path}</p>
                    </div>
                    <span className="rounded-lg border border-border bg-black/20 px-2 py-1 text-[10px] font-semibold text-text-secondary">
                      {project.entries.length} key{project.entries.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-3 text-[11px] text-muted">{formatDate(project.lastExportAt)}</p>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      {(manageOpen || selectedProjectId === 'new') && (
        <EnvProjectsModal
          onClose={() => {
            setManageOpen(false)
            if (selectedProjectId === 'new') setSelectedProjectId(null)
          }}
        />
      )}
    </div>
  )
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
