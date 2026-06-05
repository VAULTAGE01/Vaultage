import { useMemo, useState } from 'react'
import { useVault, findFolder, orderedFolderItems } from '../vaultContext'
import type { VaultFolder, VaultSecret } from '../types'
import AddSecretModal from './AddSecretModal.open'
import AuditLogModal from './AuditLogModal'
import ImportModal from './ImportModal'
import ModeSwitcher from './ModeSwitcher.open'
import { Button } from '@/components/ui/button'
import {
  FileKey2,
  Folder,
  FolderPlus,
  History,
  Import,
  Lock,
  Plus,
} from 'lucide-react'

type AppView = 'dashboard' | 'folders'

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

interface Props {
  view: AppView
  onViewChange: (view: AppView) => void
}

export default function Sidebar({ view, onViewChange }: Props) {
  const { state, selectFolder, selectSecret, addFolder, lock } = useVault()
  const [showNewSecret, setShowNewSecret] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const root = state.vault?.root ?? null
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag-region border-b border-border px-4 pb-4 pt-5">
        <div className="no-drag flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Vaultage</p>
            <p className="text-sm font-semibold text-text">Community</p>
          </div>
          <Button variant="ghost" size="icon" title="Lock vault" onClick={() => { void lock() }}>
            <Lock className="h-4 w-4" />
          </Button>
        </div>
        <div className="no-drag mt-4">
          <ModeSwitcher />
        </div>
      </header>

      <div className="flex gap-2 border-b border-border px-3 py-3">
        <Button
          variant={view === 'dashboard' ? 'secondary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => onViewChange('dashboard')}
        >
          Vault
        </Button>
        <Button
          variant={view === 'folders' ? 'secondary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => onViewChange('folders')}
        >
          Folders
        </Button>
      </div>

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
            selectedFolderId={state.selectedFolderId}
            selectedSecretId={state.selectedSecretId}
            onOpenFolder={openFolder}
            onOpenSecret={openSecret}
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
          <Button variant="outline" size="sm" onClick={() => setShowAudit(true)}>
            <History className="mr-1.5 h-3.5 w-3.5" />
            Audit
          </Button>
        </div>
      </footer>

      {showNewSecret && targetFolderId && (
        <AddSecretModal folderId={targetFolderId} onClose={() => setShowNewSecret(false)} />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showAudit && <AuditLogModal onClose={() => setShowAudit(false)} />}
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
