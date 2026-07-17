import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'
import { useVault, findFolder, orderedFolderItems } from '../vaultContext'
import { useMode, type AppMode } from '../modeContext.open'
import type { EnvProject, VaultFolder, VaultSecret } from '../types'
import AddSecretModal from './AddSecretModal.open'
import AuditLogModal from './AuditLogModal'
import EnvProjectsModal from './EnvProjectsModal'
import ExportModal from './ExportModal'
import ImportModal from './ImportModal'
import ModeSwitcher from './ModeSwitcher.open'
import { Button } from '@/components/ui/button'
import {
  FileKey2,
  Download,
  Folder,
  FolderKanban,
  FolderPlus,
  History,
  Import,
  Lock,
  Plus,
  Settings2,
} from 'lucide-react'

type AppView = 'dashboard' | 'folders'

interface Props {
  view: AppView
  onViewChange: (view: AppView) => void
}

export default function Sidebar({ view, onViewChange }: Props) {
  const { state, selectFolder, selectSecret, addFolder, lock } = useVault()
  const { mode, setMode, selectedProjectId, setSelectedProjectId } = useMode()
  const [showNewSecret, setShowNewSecret] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [projectModal, setProjectModal] = useState<{
    initialProjectId?: string | null
    startNew?: boolean
  } | null>(null)
  const root = state.vault?.root ?? null
  const projects = state.vault?.envProjects ?? []
  const selectedFolder = useMemo(
    () => root ? findFolder(root, state.selectedFolderId ?? root.id) ?? root : null,
    [root, state.selectedFolderId],
  )
  const targetFolderId = selectedFolder?.id ?? root?.id

  const createFolder = async () => {
    if (!targetFolderId) return
    const name = window.prompt('Folder name')
    if (!name?.trim()) return
    await addFolder(targetFolderId, name.trim())
  }

  const openFolder = (folderId: string) => {
    selectFolder(folderId)
    onViewChange('folders')
  }

  const openSecret = (secretId: string) => {
    selectSecret(secretId)
    onViewChange('folders')
  }

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId)
    selectSecret(null)
    onViewChange('dashboard')
    void setMode('projects')
  }

  const handleModeSelect = (nextMode: AppMode) => {
    onViewChange('dashboard')
    setSelectedProjectId(null)
    selectSecret(null)
    if (nextMode === 'local' && root) selectFolder(root.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag-region relative border-b border-border px-4 pb-4 pt-9">
        <div className="no-drag absolute right-3 top-1 flex items-center gap-1">
          <Button variant="ghost" size="icon" title="Lock vault" onClick={() => { void lock() }}>
            <Lock className="h-4 w-4" />
          </Button>
        </div>
        <div className="no-drag">
          <p className="min-w-0 text-sm font-semibold text-text">Vaultage Community Edition</p>
        </div>
        <div className="no-drag mt-4">
          <ModeSwitcher onModeSelect={handleModeSelect} />
        </div>
      </header>

      {mode === 'projects' ? (
        <>
          <div className="flex items-center gap-2 border-b border-border px-3 py-3">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => setProjectModal({ startNew: true })}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Project
            </Button>
            <Button
              variant="outline"
              size="icon"
              title="Manage project mappings"
              onClick={() => setProjectModal({ initialProjectId: selectedProjectId })}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Saved Projects</p>
              <span className="text-[10px] text-muted">{projects.length}</span>
            </div>

            {projects.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted">No projects yet. Add one to map vault fields into a local `.env` file.</p>
            ) : (
              <div className="space-y-1">
                {projects.map(project => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    selected={selectedProjectId === project.id}
                    onOpen={() => openProject(project.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <footer className="border-t border-border p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setProjectModal({ initialProjectId: selectedProjectId })}
            >
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Manage Mappings
            </Button>
          </footer>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border px-3 py-3">
            <Button size="sm" className="flex-1" disabled={!targetFolderId} onClick={() => setShowNewSecret(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Secret
            </Button>
            <Button variant="outline" size="icon" disabled={!targetFolderId} title="New folder" onClick={() => { void createFolder() }}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {root ? (
              <FolderNode
                folder={root}
                depth={0}
                selectedFolderId={view === 'folders' ? state.selectedFolderId : null}
                selectedSecretId={state.selectedSecretId}
                onOpenFolder={openFolder}
                onOpenSecret={openSecret}
              />
            ) : (
              <p className="px-3 py-4 text-xs text-muted">Unlock your vault to browse folders.</p>
            )}
          </div>

          <footer className="border-t border-border p-3">
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Import className="mr-1.5 h-3.5 w-3.5" />
                Import
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowAudit(true)}>
                <History className="mr-1.5 h-3.5 w-3.5" />
                Audit
              </Button>
            </div>
          </footer>
        </>
      )}

      {showNewSecret && targetFolderId && (
        <AddSecretModal folderId={targetFolderId} onClose={() => setShowNewSecret(false)} />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showExport && <ExportModal initialScope={{ kind: 'vault' }} onClose={() => setShowExport(false)} />}
      {showAudit && <AuditLogModal onClose={() => setShowAudit(false)} />}
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

function FolderNode({
  folder,
  depth,
  selectedFolderId,
  selectedSecretId,
  onOpenFolder,
  onOpenSecret,
}: {
  folder: VaultFolder
  depth: number
  selectedFolderId: string | null
  selectedSecretId: string | null
  onOpenFolder: (id: string) => void
  onOpenSecret: (id: string) => void
}) {
  const ordered = orderedFolderItems(folder)
  const secrets = new Map(folder.secrets.map(secret => [secret.id, secret]))
  const folders = new Map(folder.children.map(child => [child.id, child]))

  return (
    <div>
      <button
        type="button"
        onClick={() => onOpenFolder(folder.id)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
          selectedFolderId === folder.id ? 'bg-white/10 text-text' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <Folder className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{folder.name}</span>
      </button>
      <div>
        {ordered.map(item => {
          if (item.kind === 'folder') {
            const child = folders.get(item.id)
            return child ? (
              <FolderNode
                key={`folder:${child.id}`}
                folder={child}
                depth={depth + 1}
                selectedFolderId={selectedFolderId}
                selectedSecretId={selectedSecretId}
                onOpenFolder={onOpenFolder}
                onOpenSecret={onOpenSecret}
              />
            ) : null
          }
          const secret = secrets.get(item.id)
          return secret ? (
            <SecretRow
              key={`secret:${secret.id}`}
              secret={secret}
              depth={depth + 1}
              selected={selectedSecretId === secret.id}
              onOpen={() => onOpenSecret(secret.id)}
            />
          ) : null
        })}
      </div>
    </div>
  )
}

function SecretRow({
  secret,
  depth,
  selected,
  onOpen,
}: {
  secret: VaultSecret
  depth: number
  selected: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
        selected ? 'bg-accent/10 text-text' : 'text-muted hover:bg-white/[0.06] hover:text-text',
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <FileKey2 className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{secret.name}</span>
    </button>
  )
}

function ProjectRow({
  project,
  selected,
  onOpen,
}: {
  project: EnvProject
  selected: boolean
  onOpen: () => void
}) {
  const readyCount = project.entries.filter(entry => entry.envKey && entry.secretId && entry.fieldKey).length
  const pathLabel = project.path ? project.path.split('/').slice(-2).join('/') : 'No folder linked'

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full rounded-md px-2 py-2 text-left transition-colors',
        selected ? 'bg-accent/10 text-text' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text',
      )}
    >
      <div className="flex items-center gap-2">
        <FolderKanban className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{project.name}</span>
      </div>
      <p className="mt-1 truncate pl-5 text-[10px] text-muted">{pathLabel}</p>
      <p className="mt-0.5 pl-5 text-[10px] text-muted">
        {readyCount}/{project.entries.length} mapped key{project.entries.length === 1 ? '' : 's'}
      </p>
    </button>
  )
}
