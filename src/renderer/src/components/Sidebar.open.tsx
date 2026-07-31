import { useMemo, useState } from 'react'
import { useVault, findFolder } from '../vaultContext'
import { useMode, type AppMode } from '../modeContext.open'
import AddSecretModal from './AddSecretModal.open'
import AuditLogModal from './AuditLogModal'
import EnvProjectsModal from './EnvProjectsModal'
import ExportModal from './ExportModal'
import ImportModal from './ImportModal'
import ModeSwitcher from './ModeSwitcher.open'
import VaultFolderTree from './VaultFolderTree.open'
import CommunitySettingsModal from './CommunitySettingsModal.open'
import ChangePasswordModal from './ChangePasswordModal'
import KeyboardShortcutsModal from './KeyboardShortcutsModal'
import CommunityProjectRow from './CommunityProjectRow.open'
import { useCommunitySidebarShortcuts } from './useCommunitySidebarShortcuts.open'
import { Button } from '@/components/ui/button'
import { createFolderFromInput } from '@/lib/textInputRequests'
import { useTextInputDialog } from './TextInputDialogProvider'
import {
  isPinnedTarget,
  togglePinnedTargetOrder,
} from '../lib/pinning'
import {
  FolderPlus,
  Import,
  Lock,
  Plus,
  Settings2,
} from 'lucide-react'
type Props = {
  view: 'dashboard' | 'folders'
  onViewChange: (view: AppView) => void
}
type AppView = Props['view']
export default function Sidebar({ view, onViewChange }: Props) {
  const requestTextInput = useTextInputDialog()
  const { state, selectFolder, selectSecret, addFolder, moveTreeItem, setPreferences, lock } = useVault()
  const { mode, setMode, selectedProjectId, setSelectedProjectId } = useMode()
  const [showNewSecret, setShowNewSecret] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [projectModal, setProjectModal] = useState<{
    initialProjectId?: string | null
    startNew?: boolean
  } | null>(null)
  const root = state.vault?.root ?? null
  const projects = state.vault?.envProjects ?? []
  const pinnedOrder = state.vault?.preferences?.localDashboardPinnedOrder ?? []
  const selectedFolder = useMemo(
    () => root ? findFolder(root, state.selectedFolderId ?? root.id) ?? root : null,
    [root, state.selectedFolderId],
  )
  const targetFolderId = selectedFolder?.id ?? root?.id

  const createFolder = async () => {
    const parentFolderId = targetFolderId
    if (!parentFolderId) return
    const name = await requestTextInput({
      title: 'New folder',
      description: 'Create a folder inside the currently selected vault location.',
      label: 'Folder name',
      confirmLabel: 'Create folder',
      placeholder: 'Folder name',
      validation: { kind: 'non-empty' },
    })
    await createFolderFromInput(parentFolderId, name, addFolder)
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
  const togglePinnedProject = (projectId: string) => {
    void setPreferences({
      localDashboardPinnedOrder: togglePinnedTargetOrder(pinnedOrder, 'project', projectId),
    })
  }
  const handleModeSelect = (nextMode: AppMode) => {
    onViewChange('dashboard')
    setSelectedProjectId(null)
    selectSecret(null)
    if (nextMode === 'local' && root) selectFolder(root.id)
  }

  useCommunitySidebarShortcuts({
    mode,
    targetFolderId,
    onNewProject: () => setProjectModal({ startNew: true }),
    onNewSecret: () => setShowNewSecret(true),
    onImport: () => setShowImport(true),
    onExport: () => setShowExport(true),
    onSettings: () => setShowSettings(true),
    onShortcuts: () => setShowShortcuts(true),
  })

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
              <p className="px-2 py-4 text-xs text-muted">No projects yet. Add one to map Vault fields into a local .env file.</p>
            ) : (
              <div className="space-y-1">
                {projects.map(project => (
                  <CommunityProjectRow
                    key={project.id}
                    project={project}
                    selected={selectedProjectId === project.id}
                    pinned={isPinnedTarget(pinnedOrder, 'project', project.id)}
                    onOpen={() => openProject(project.id)}
                    onTogglePin={() => togglePinnedProject(project.id)}
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
              <VaultFolderTree
                root={root}
                selectedFolderId={view === 'folders' ? state.selectedFolderId : null}
                selectedSecretId={state.selectedSecretId}
                onOpenFolder={openFolder}
                onOpenSecret={openSecret}
                onMoveItem={moveTreeItem}
              />
            ) : (
              <p className="px-3 py-4 text-xs text-muted">Unlock your vault to browse folders.</p>
            )}
          </div>

          <footer className="border-t border-border p-3">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Import className="mr-1.5 h-3.5 w-3.5" />
                Import
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                Settings
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
      <CommunitySettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        onOpenImport={() => setShowImport(true)}
        onOpenExport={() => setShowExport(true)}
        onOpenAudit={() => setShowAudit(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onOpenChangePassword={() => setShowChangePassword(true)}
      />
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
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
