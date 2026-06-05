import { useState } from 'react'
import type { ReactNode } from 'react'
import { useVault, findFolder, findSecret, flatSecrets } from '../vaultContext'
import type { SecretField, VaultSecret } from '../types'
import AddSecretModal from './AddSecretModal.open'
import EnvProjectsModal from './EnvProjectsModal'
import ExportModal from './ExportModal'
import { PinSecretButton } from './PinSecretButton'
import { isPinnedSecret, togglePinnedSecret } from '../lib/pinning'
import { SECRET_TYPE_LABELS } from '../types'
import type { VaultExportScope } from '../../../shared/vaultExport'
import { Button } from '@/components/ui/button'
import { Eye, FileKey2, FolderKanban, Pencil, ShieldCheck, Trash2 } from 'lucide-react'

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function LocalDashboard({ onOpenSecret }: { onOpenSecret?: () => void } = {}) {
  const { state, selectSecret } = useVault()
  const [showProjects, setShowProjects] = useState(false)
  const secrets = state.vault ? flatSecrets(state.vault.root) : []
  const projects = state.vault?.envProjects ?? []
  const pinned = secrets.filter(({ secret }) => isPinnedSecret(secret)).slice(0, 6)
  const recent = [...secrets]
    .sort((a, b) => Date.parse(b.secret.updatedAt) - Date.parse(a.secret.updatedAt))
    .slice(0, 8)

  const openSecret = (id: string) => {
    selectSecret(id)
    onOpenSecret?.()
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-7">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">My Vault</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">Local Secrets</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          Store encrypted credentials locally, organize them into folders, and map values to projects when needed.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric title="Secrets" value={secrets.length} />
        <Metric title="Projects" value={projects.length} />
        <Metric title="Pinned" value={pinned.length} />
      </div>

      {pinned.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-text">Pinned</h2>
          <div className="grid gap-3 xl:grid-cols-3">
            {pinned.map(({ secret, folderPath }) => (
              <SecretCard key={secret.id} secret={secret} meta={folderPath} onOpen={() => openSecret(secret.id)} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 grid min-h-0 gap-5 xl:grid-cols-[1fr_320px]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-text">Recently Updated</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No secrets yet. Create one from the sidebar.</p>
            ) : recent.map(({ secret, folderPath }) => (
              <button
                key={secret.id}
                type="button"
                onClick={() => openSecret(secret.id)}
                className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{secret.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">{folderPath}</p>
                </div>
                <span className="text-[10px] text-muted">{SECRET_TYPE_LABELS[secret.type]}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text">Project Mappings</p>
              <p className="mt-1 text-xs text-muted">Export mapped vault fields into local `.env` files.</p>
            </div>
            <FolderKanban className="h-4 w-4 text-muted" />
          </div>
          <div className="mt-4 space-y-2">
            {projects.slice(0, 5).map(project => (
              <div key={project.id} className="rounded-lg border border-border bg-black/10 px-3 py-2">
                <p className="truncate text-xs font-medium text-text">{project.name}</p>
                <p className="mt-0.5 text-[10px] text-muted">{project.entries.length} mapped key{project.entries.length === 1 ? '' : 's'}</p>
              </div>
            ))}
            {projects.length === 0 && <p className="text-xs text-muted">No project mappings yet.</p>}
          </div>
          <Button className="mt-4 w-full" variant="outline" onClick={() => setShowProjects(true)}>
            Manage Projects
          </Button>
        </aside>
      </section>

      {showProjects && <EnvProjectsModal onClose={() => setShowProjects(false)} />}
    </div>
  )
}

export default function SecretDetail({ emptyState = 'dashboard' }: { emptyState?: 'dashboard' | 'folder' } = {}) {
  const {
    state,
    copySecretField,
    revealSecretField,
    updateSecret,
    deleteSecret,
    selectSecret,
  } = useVault()
  const [editing, setEditing] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [exportScope, setExportScope] = useState<VaultExportScope | null>(null)

  if (!state.vault || !state.selectedSecretId) {
    return emptyState === 'folder' ? <FolderEmptyState /> : <LocalDashboard />
  }

  const result = findSecret(state.vault.root, state.selectedSecretId)
  if (!result) return <FolderEmptyState />
  const { secret, folderId } = result
  const folder = findFolder(state.vault.root, folderId)
  const pinned = isPinnedSecret(secret)
  const updated = new Date(secret.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  const remove = async () => {
    if (!window.confirm(`Delete "${secret.name}"? This cannot be undone.`)) return
    await deleteSecret(folderId, secret.id)
    selectSecret(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="drag-region flex items-center gap-2 border-b border-border px-5 py-3">
        <p className="no-drag flex-1 truncate text-xs text-muted">{folder?.name ?? 'Vault'}</p>
        <Button className="no-drag" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit
        </Button>
        <Button className="no-drag" variant="ghost" size="sm" onClick={() => setExportScope({ kind: 'secret', id: secret.id })}>
          Export
        </Button>
        <Button className="no-drag" variant="destructive" size="sm" onClick={() => { void remove() }}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mb-6 flex items-start gap-4 border-b border-border pb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface">
            <FileKey2 className="h-5 w-5 text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-text">{secret.name}</h1>
              <PinSecretButton pinned={pinned} onClick={() => { void updateSecret(folderId, togglePinnedSecret(secret)) }} />
            </div>
            <p className="mt-1 text-xs text-muted">{SECRET_TYPE_LABELS[secret.type]} · Updated {updated}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {secret.scope && <Badge>{secret.scope}</Badge>}
              {secret.tags?.map(tag => <Badge key={tag}>{tag}</Badge>)}
              {secret.expiresAt && <Badge>Expires {secret.expiresAt}</Badge>}
            </div>
          </div>
        </div>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text">Local Source Of Truth</p>
              <p className="mt-1 text-xs text-muted">Values stay encrypted locally. Copy and reveal actions are confirmed through the app.</p>
            </div>
            <ShieldCheck className="h-4 w-4 text-muted" />
          </div>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => setShowProjects(true)}>
            <FolderKanban className="mr-1.5 h-3.5 w-3.5" />
            Project Mappings
          </Button>
        </section>

        <section className="space-y-3">
          {secret.fields.map((field, index) => (
            <FieldRow
              key={`${field.key}-${index}`}
              field={field}
              onCopy={() => copySecretField(secret.id, field.key, { clearAfterMs: 30_000 })}
              onReveal={() => revealSecretField(secret.id, field.key)}
            />
          ))}
        </section>

        {secret.description && (
          <section className="mt-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Description</p>
            <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-secondary">{secret.description}</p>
          </section>
        )}

        {secret.notes && (
          <section className="mt-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Notes</p>
            <p className="whitespace-pre-wrap rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-secondary">{secret.notes}</p>
          </section>
        )}
      </main>

      {editing && <AddSecretModal folderId={folderId} existing={secret} onClose={() => setEditing(false)} />}
      {showProjects && <EnvProjectsModal onClose={() => setShowProjects(false)} />}
      {exportScope && <ExportModal initialScope={exportScope} onClose={() => setExportScope(null)} />}
    </div>
  )
}

function FolderEmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <FileKey2 className="mx-auto h-8 w-8 text-muted" />
        <p className="mt-3 text-sm font-medium text-text">Select a secret</p>
        <p className="mt-1 text-xs text-muted">Choose a saved value from the sidebar to view, copy, reveal, or export it.</p>
      </div>
    </div>
  )
}

function FieldRow({
  field,
  onCopy,
  onReveal,
}: {
  field: SecretField
  onCopy: () => Promise<boolean>
  onReveal: () => Promise<string | null>
}) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)

  const copy = async () => {
    setCopying(true)
    try {
      await onCopy()
    } finally {
      setTimeout(() => setCopying(false), 700)
    }
  }

  const reveal = async () => {
    const value = await onReveal()
    if (value != null) setRevealed(value)
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{field.key}</p>
          <p className={cn('mt-1 font-mono text-xs', revealed ? 'break-all text-text-secondary' : 'text-muted')}>
            {revealed ?? (field.sensitive ? '••••••••••••' : field.value || 'Empty')}
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => { void copy() }}>
            {copying ? 'Copied' : 'Copy'}
          </Button>
          {field.sensitive && (
            <Button variant="ghost" size="sm" onClick={() => { void reveal() }}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Reveal
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
    </div>
  )
}

function SecretCard({ secret, meta, onOpen }: { secret: VaultSecret; meta: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-white/[0.16]"
    >
      <p className="truncate text-sm font-semibold text-text">{secret.name}</p>
      <p className="mt-1 truncate text-[11px] text-muted">{meta}</p>
    </button>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-black/20 px-2 py-0.5 text-[10px] text-text-secondary">
      {children}
    </span>
  )
}
