import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useVault, findFolder, findSecret, flatSecrets } from '../vaultContext'
import type { SecretField, VaultFolder } from '../types'
import AddSecretModal from './AddSecretModal.open'
import EnvProjectsModal from './EnvProjectsModal'
import ExportModal from './ExportModal'
import { PinSecretButton } from './PinSecretButton'
import { isPinnedSecret, togglePinnedSecret } from '../lib/pinning'
import { SECRET_TYPE_LABELS } from '../types'
import type { VaultExportScope } from '../../../shared/vaultExport'
import { Button } from '@/components/ui/button'
import { Copy, Download, Eye, EyeOff, FileKey2, FolderKanban, Image as ImageIcon, Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { countSecretProjectMappings, secretDeletionConfirmation } from '@/lib/secretActionPreviews'
import { useTransientReveal } from '../lib/useTransientReveal'
import { requestPlaintextExportConfirmation } from '@/lib/textInputRequests'
import { useTextInputDialog } from './TextInputDialogProvider'
import {
  collectCommunityPinnedCollections,
  CommunityPinnedVaultLists,
} from './PinnedVaultLists.open'
import CommunitySecretContext from './CommunitySecretContext.open'
import {
  readSecretAccessPolicy,
  writeSecretAccessPolicy,
} from '../../../shared/secretAccessPolicy'
import { isProductionScope } from '@/lib/env'

function countFolders(folder: VaultFolder): number {
  return folder.children.length + folder.children.reduce((total, child) => total + countFolders(child), 0)
}

export function LocalDashboard({ onOpenSecret }: { onOpenSecret?: () => void } = {}) {
  const { state, selectFolder, selectSecret } = useVault()
  const [showProjects, setShowProjects] = useState(false)
  const secrets = state.vault ? flatSecrets(state.vault.root) : []
  const projects = state.vault?.envProjects ?? []
  const folderCount = state.vault ? countFolders(state.vault.root) : 0
  const mappedKeyCount = projects.reduce((total, project) => total + project.entries.length, 0)
  const typeCount = new Set(secrets.map(({ secret }) => secret.type)).size
  const pinned = secrets.filter(({ secret }) => isPinnedSecret(secret)).slice(0, 6)
  const pinnedCollections = state.vault
    ? collectCommunityPinnedCollections(state.vault.root)
    : []
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
        <Metric title="Folders" value={folderCount} />
        <Metric title="Pinned" value={pinned.length} />
        <Metric title="Projects" value={projects.length} />
        <Metric title="Mapped Keys" value={mappedKeyCount} />
        <Metric title="Types" value={typeCount} />
      </div>

      <CommunityPinnedVaultLists
        pinnedSecrets={pinned}
        pinnedCollections={pinnedCollections}
        onOpenSecret={({ secret }) => openSecret(secret.id)}
        onOpenCollection={(collection) => {
          selectFolder(collection.id)
          selectSecret(null)
          onOpenSecret?.()
        }}
      />

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
              <p className="text-sm font-semibold text-text">Vault Structure</p>
              <p className="mt-1 text-xs text-muted">Folders organize local records. Project links now live in Projects mode.</p>
            </div>
            <FolderKanban className="h-4 w-4 text-muted" />
          </div>
          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-border bg-black/10 px-3 py-2">
              <p className="text-xs font-medium text-text">{folderCount} folder{folderCount === 1 ? '' : 's'}</p>
              <p className="mt-0.5 text-[10px] text-muted">Nested vault organization</p>
            </div>
            {projects.slice(0, 5).map(project => (
              <div key={project.id} className="rounded-lg border border-border bg-black/10 px-3 py-2">
                <p className="truncate text-xs font-medium text-text">{project.name}</p>
                <p className="mt-0.5 text-[10px] text-muted">{project.entries.length} mapped key{project.entries.length === 1 ? '' : 's'}</p>
              </div>
            ))}
            {projects.length === 0 && <p className="text-xs text-muted">No project links yet.</p>}
          </div>
          <Button className="mt-4 w-full" variant="outline" onClick={() => setShowProjects(true)}>
            Manage Project Links
          </Button>
        </aside>
      </section>

      {showProjects && <EnvProjectsModal onClose={() => setShowProjects(false)} />}
    </div>
  )
}

export default function SecretDetail({ emptyState = 'dashboard' }: { emptyState?: 'dashboard' | 'folder' } = {}) {
  const requestTextInput = useTextInputDialog()
  const {
    state,
    copySecretField,
    copySecretImageField,
    revealSecretField,
    revealSecretImageField,
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
  const imageField = secret.fields.find(field => field.key === '__image__')
  const revealCopyAllowed = readSecretAccessPolicy(secret).revealCopy
  const updated = new Date(secret.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  const remove = async () => {
    if (!window.confirm(secretDeletionConfirmation({
      secret,
      projectMappingCount: countSecretProjectMappings(state.vault?.envProjects ?? [], secret.id),
    }))) return
    await deleteSecret(folderId, secret.id)
    selectSecret(null)
  }

  const saveImage = async (): Promise<boolean> => {
    const plaintextConfirmation = await requestPlaintextExportConfirmation({
      platform: window.vault.platform,
      e2eBypass: import.meta.env.VITE_E2E === '1',
    }, requestTextInput)
    if (plaintextConfirmation === null) return false
    try {
      const result = await window.vault.saveSecretImageField({
        secretId: secret.id,
        fieldKey: '__image__',
        fieldId: imageField?.id,
        plaintextConfirmation,
      })
      if (result.success) toast.success('Image saved')
      else if (!result.cancelled) toast.error(result.error ?? 'Could not save image')
      return result.success
    } catch (error) {
      toast.error(`Could not save image: ${String(error)}`)
      return false
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {isProductionScope(secret.scope) && (
        <div className="flex-shrink-0 border-b border-amber-300/20 bg-amber-300/10 px-4 py-1.5 text-[11px] font-medium text-amber-200">
          Production secret — copy and reveal actions are audited.
        </div>
      )}
      <header className="drag-region flex items-center gap-2 border-b border-border px-5 py-3">
        <p className="no-drag flex-1 truncate text-xs text-muted">{folder?.name ?? 'Vault'}</p>
        <Button className="no-drag" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit
        </Button>
        <Button className="no-drag" variant="ghost" size="sm" onClick={() => setExportScope({ kind: 'secret', id: secret.id })}>
          Export
        </Button>
        <Button
          className="no-drag"
          variant="destructive"
          size="sm"
          title="Permanently delete this encrypted vault record and remove its project mappings; exported files remain."
          onClick={() => { void remove() }}
        >
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

        {secret.type === 'image' ? (
          <ImageField
            identity={`${secret.id}:${secret.updatedAt}:${imageField?.id ?? '__image__'}`}
            hasImage={Boolean(imageField?.value)}
            releaseAllowed={revealCopyAllowed}
            onCopy={() => copySecretImageField(secret.id, '__image__', imageField?.id)}
            onReveal={() => revealSecretImageField(secret.id, '__image__', { fieldId: imageField?.id })}
            onSave={saveImage}
          />
        ) : (
          <section className="space-y-3">
            {secret.fields.filter(field => field.key !== '__image__').map((field, index) => (
              <FieldRow
                key={`${field.key}-${index}`}
                identity={`${secret.id}:${secret.updatedAt}:${field.id ?? field.key}:${index}`}
                field={field}
                releaseAllowed={revealCopyAllowed}
                onCopy={() => copySecretField(secret.id, field.key, { fieldId: field.id })}
                onReveal={() => revealSecretField(secret.id, field.key, { fieldId: field.id })}
              />
            ))}
          </section>
        )}

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

        <CommunitySecretContext
          secret={secret}
          projects={state.vault.envProjects}
          folderName={folder?.name ?? 'Vault'}
          revealCopyAllowed={revealCopyAllowed}
          onRevealCopyChange={allowed => {
            const policy = readSecretAccessPolicy(secret)
            void updateSecret(folderId, writeSecretAccessPolicy(secret, { ...policy, revealCopy: allowed }))
          }}
        />
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

function ImageField({
  identity,
  hasImage,
  releaseAllowed,
  onCopy,
  onReveal,
  onSave,
}: {
  identity: string
  hasImage: boolean
  releaseAllowed: boolean
  onCopy: () => Promise<boolean>
  onReveal: () => Promise<string | null>
  onSave: () => Promise<boolean>
}) {
  const [copying, setCopying] = useState(false)
  const [revealFailed, setRevealFailed] = useState(false)
  const { value: dataUrl, reveal: revealTransient, clear } = useTransientReveal<string>(identity)

  useEffect(() => setRevealFailed(false), [identity])

  const copy = async () => {
    const copied = await onCopy()
    if (!copied) {
      toast.error('Could not copy image')
      return
    }
    setCopying(true)
    setTimeout(() => setCopying(false), 700)
  }

  const reveal = async () => {
    setRevealFailed(false)
    const outcome = await revealTransient(onReveal)
    if (outcome === 'empty') setRevealFailed(true)
  }

  if (!hasImage) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        No image stored.
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      {dataUrl ? (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-black/20">
            <img src={dataUrl} alt="Stored secret" className="max-h-[50vh] w-full object-contain" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={clear}>
              Hide Image
            </Button>
            <Button variant="ghost" size="sm" disabled={!releaseAllowed} onClick={() => { void copy() }}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copying ? 'Copied' : 'Copy Image'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { void onSave() }}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Save Image
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <ImageIcon className="h-8 w-8 text-muted" />
          <div>
            <p className="text-sm font-semibold text-text">Image hidden</p>
            <p className="mt-1 text-xs text-muted">Reveal it only when you need to inspect or copy it.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" disabled={!releaseAllowed} onClick={() => { void reveal() }}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Show Image
            </Button>
            <Button variant="ghost" size="sm" disabled={!releaseAllowed} onClick={() => { void copy() }}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copying ? 'Copied' : 'Copy Image'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { void onSave() }}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Save Image
            </Button>
          </div>
          {revealFailed && <p className="text-xs text-danger">Could not reveal this image.</p>}
        </div>
      )}
    </section>
  )
}

function FieldRow({
  identity,
  field,
  releaseAllowed,
  onCopy,
  onReveal,
}: {
  identity: string
  field: SecretField
  releaseAllowed: boolean
  onCopy: () => Promise<boolean>
  onReveal: () => Promise<string | null>
}) {
  const [copying, setCopying] = useState(false)
  const { value: revealed, reveal: revealTransient, clear } = useTransientReveal<string>(identity)

  const copy = async () => {
    const copied = await onCopy()
    if (!copied) {
      toast.error('Could not copy value')
      return
    }
    setCopying(true)
    setTimeout(() => setCopying(false), 700)
  }

  const reveal = async () => {
    if (revealed !== null) {
      clear()
      return
    }
    await revealTransient(onReveal)
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
          <Button variant="outline" size="sm" disabled={!releaseAllowed} onClick={() => { void copy() }}>
            {copying ? 'Copied' : 'Copy'}
          </Button>
          {field.sensitive && (
            <Button variant="ghost" size="sm" disabled={!releaseAllowed} onClick={() => { void reveal() }}>
              {revealed !== null ? <EyeOff className="mr-1.5 h-3.5 w-3.5" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
              {revealed !== null ? 'Hide' : 'Reveal'}
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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-black/20 px-2 py-0.5 text-[10px] text-text-secondary">
      {children}
    </span>
  )
}
