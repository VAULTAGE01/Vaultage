import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useVault } from '../vaultContext'
import type { EnvEntry, EnvProject, VaultFolder, VaultSecret } from '../types'

function cn(...cls: (string | false | null | undefined)[]) { return cls.filter(Boolean).join(' ') }

const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT'

// ── Flatten all secrets from the vault tree ────────────────────────────────

function flatSecrets(
  node: VaultFolder,
  folderName = node.name,
): { secret: VaultSecret; folderName: string }[] {
  const here = node.secrets.map(s => ({ secret: s, folderName }))
  const nested = node.children.flatMap(c => flatSecrets(c, c.name))
  return [...here, ...nested]
}

// ── Entry row ─────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry:     EnvEntry
  allSecrets: { secret: VaultSecret; folderName: string }[]
  onChange:  (e: EnvEntry) => void
  onDelete:  () => void
}

function EntryRow({ entry, allSecrets, onChange, onDelete }: EntryRowProps) {
  const selectedSecret = allSecrets.find(x => x.secret.id === entry.secretId)?.secret
  const fieldOptions   = selectedSecret?.fields.filter(f => f.value) ?? []

  return (
    <div className="flex items-center gap-2 group">
      <input
        type="text"
        value={entry.envKey}
        onChange={e => onChange({ ...entry, envKey: e.target.value })}
        placeholder="ENV_KEY"
        className="w-40 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text placeholder-muted outline-none focus:border-accent font-mono transition-colors flex-shrink-0"
      />
      <span className="text-muted text-xs flex-shrink-0">→</span>
      <select
        value={entry.secretId}
        onChange={e => onChange({ ...entry, secretId: e.target.value, fieldKey: '' })}
        className="flex-1 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent transition-colors"
      >
        <option value="">— select secret —</option>
        {allSecrets.map(({ secret, folderName }) => (
          <option key={secret.id} value={secret.id}>
            {folderName} / {secret.name}
          </option>
        ))}
      </select>
      <select
        value={entry.fieldKey}
        onChange={e => onChange({ ...entry, fieldKey: e.target.value })}
        disabled={!entry.secretId}
        className="w-32 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent disabled:opacity-40 transition-colors flex-shrink-0"
      >
        <option value="">— field —</option>
        {fieldOptions.map(f => (
          <option key={f.key} value={f.key}>{f.key}</option>
        ))}
      </select>
      <button onClick={onDelete}
        className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── EnvProjectsModal ───────────────────────────────────────────────────────

interface Props { onClose: () => void }

export default function EnvProjectsModal({ onClose }: Props) {
  const { state, addEnvProject, updateEnvProject, deleteEnvProject } = useVault()
  const projects   = state.vault?.envProjects ?? []
  const allSecrets = state.vault ? flatSecrets(state.vault.root) : []

  const [selectedId,  setSelectedId]  = useState<string | null>(projects[0]?.id ?? null)
  const [newName,     setNewName]     = useState('')
  const [showNewForm, setShowNewForm] = useState(false)

  // Local editable copy of the selected project
  const baseProject  = projects.find(p => p.id === selectedId) ?? null
  const [localName,        setLocalName]        = useState(baseProject?.name ?? '')
  const [localPath,        setLocalPath]        = useState(baseProject?.path ?? '')
  const [localEntries,     setLocalEntries]     = useState<EnvEntry[]>(baseProject?.entries ?? [])
  const [localGitignore,   setLocalGitignore]   = useState(baseProject?.addToGitignore ?? true)
  const [saving,           setSaving]           = useState(false)
  const [exporting,        setExporting]        = useState(false)
  const [exportResult,     setExportResult]     = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirmExport,    setConfirmExport]    = useState(false)
  const [confirmText,      setConfirmText]      = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const selectProject = (p: EnvProject) => {
    setSelectedId(p.id)
    setLocalName(p.name)
    setLocalPath(p.path)
    setLocalEntries(p.entries)
    setLocalGitignore(p.addToGitignore)
    setExportResult(null)
    setConfirmExport(false)
    setConfirmText('')
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    await addEnvProject({
      name: newName.trim(), path: '', entries: [], addToGitignore: true,
    })
    setNewName(''); setShowNewForm(false)
    // The newly created project will appear in the list — user clicks it to open
  }

  const handlePickFolder = async () => {
    const path = await window.vault.pickFolder()
    if (path) setLocalPath(path)
  }

  const handleSave = async () => {
    if (!baseProject) return
    setSaving(true)
    try {
      await updateEnvProject({
        ...baseProject,
        name:           localName.trim() || baseProject.name,
        path:           localPath,
        entries:        localEntries,
        addToGitignore: localGitignore,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    if (!baseProject || !localPath) return
    if (!confirmExport) {
      setConfirmExport(true)
      setConfirmText('')
      setExportResult(null)
      return
    }
    if (confirmText !== PLAINTEXT_CONFIRM_PHRASE) return

    setExporting(true); setExportResult(null)

    // Save first
    await updateEnvProject({
      ...baseProject,
      name: localName.trim() || baseProject.name,
      path: localPath, entries: localEntries, addToGitignore: localGitignore,
    })

    const selections = localEntries
      .filter(e => e.envKey && e.secretId && e.fieldKey)
      .map(e => ({ envKey: e.envKey, secretId: e.secretId, fieldKey: e.fieldKey }))

    try {
      const res = await window.vault.exportEnv({
        path: localPath, selections, addToGitignore: localGitignore,
        plaintextConfirmation: confirmText,
      })
      setExportResult({ ok: res.success, msg: res.success ? `.env written to ${localPath}` : (res.error ?? 'Export failed') })
      if (res.success) {
        await updateEnvProject({ ...baseProject, name: localName.trim() || baseProject.name, path: localPath, entries: localEntries, addToGitignore: localGitignore, lastExportAt: new Date().toISOString() })
        setConfirmExport(false)
        setConfirmText('')
      }
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async (p: EnvProject) => {
    if (!confirm(`Delete project "${p.name}"?`)) return
    await deleteEnvProject(p.id)
    const remaining = projects.filter(x => x.id !== p.id)
    if (remaining.length) selectProject(remaining[0])
    else { setSelectedId(null); setLocalName(''); setLocalPath(''); setLocalEntries([]) }
  }

  const addEntry = () =>
    setLocalEntries(prev => [...prev, { envKey: '', secretId: '', fieldKey: '' }])

  const updateEntry = (i: number, e: EnvEntry) =>
    setLocalEntries(prev => prev.map((x, j) => j === i ? e : x))

  const removeEntry = (i: number) =>
    setLocalEntries(prev => prev.filter((_, j) => j !== i))

  const exportableEntryCount = localEntries.filter(e => e.envKey && e.secretId && e.fieldKey).length
  const canExport =
    !exporting &&
    Boolean(localPath) &&
    exportableEntryCount > 0 &&
    (!confirmExport || confirmText === PLAINTEXT_CONFIRM_PHRASE)

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 no-drag">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-[860px] h-[600px] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text">Env Projects</h2>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left: project list */}
          <div className="w-52 border-r border-border flex flex-col flex-shrink-0">
            <div className="flex-1 overflow-y-auto py-2">
              {projects.length === 0 && (
                <p className="px-4 py-3 text-xs text-muted italic">No projects yet</p>
              )}
              {projects.map(p => (
                <button key={p.id} onClick={() => selectProject(p)}
                  className={cn('w-full px-4 py-2.5 text-left group transition-colors',
                    p.id === selectedId ? 'bg-accent/10' : 'hover:bg-white/5')}>
                  <p className={cn('text-xs font-medium truncate', p.id === selectedId ? 'text-accent' : 'text-text')}>
                    {p.name}
                  </p>
                  <p className="text-[10px] text-muted mt-0.5 truncate">
                    {p.path ? p.path.split('/').slice(-2).join('/') : 'No path set'}
                  </p>
                  {p.lastExportAt && (
                    <p className="text-[10px] text-muted mt-0.5">
                      Exported {new Date(p.lastExportAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </button>
              ))}
            </div>

            {/* New project */}
            <div className="border-t border-border p-2">
              {showNewForm ? (
                <div className="space-y-1.5">
                  <input autoFocus type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewForm(false) }}
                    placeholder="Project name"
                    className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text placeholder-muted outline-none focus:border-accent transition-colors" />
                  <div className="flex gap-1">
                    <button onClick={() => setShowNewForm(false)}
                      className="flex-1 px-2 py-1 rounded-lg text-[10px] text-muted border border-border hover:text-text transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleCreate} disabled={!newName.trim()}
                      className="flex-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-accent text-black hover:bg-accent-hover disabled:opacity-40 transition-colors">
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowNewForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-xs transition-all text-black hover:scale-[1.02] active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #00FF7F, #00CC62)', boxShadow: '0 4px 12px rgba(0,255,127,0.2)' }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Project
                </button>
              )}
            </div>
          </div>

          {/* Right: project detail */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!baseProject ? (
              <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-bg">
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 40% 40% at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 80%)' }} />
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-text mb-1">No Project Selected</h3>
                <p className="text-xs text-muted text-center max-w-[250px]">
                  Select a project from the list to map secrets to environment variables, or create a new one.
                </p>
              </div>
            ) : (
              <>
                {/* Project toolbar */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
                  <input value={localName} onChange={e => setLocalName(e.target.value)}
                    className="flex-1 bg-transparent text-sm font-medium text-text outline-none placeholder-muted"
                    placeholder="Project name" />
                  <button onClick={() => handleDelete(baseProject)}
                    className="px-2.5 py-1 rounded-lg text-xs text-danger hover:bg-danger/10 transition-colors flex-shrink-0">
                    Delete
                  </button>
                </div>

                {/* Config */}
                <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-3">
                  {/* Path */}
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-muted uppercase tracking-wider w-16 flex-shrink-0">Path</p>
                    <p className="flex-1 text-xs font-mono text-text/80 truncate min-w-0">
                      {localPath || <span className="text-muted italic">No folder selected</span>}
                    </p>
                    <button onClick={handlePickFolder}
                      className="px-2.5 py-1 rounded-lg text-xs text-muted border border-border hover:text-text hover:border-border/60 transition-colors flex-shrink-0">
                      Change…
                    </button>
                  </div>

                  {/* Gitignore */}
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-muted uppercase tracking-wider w-16 flex-shrink-0">Gitignore</p>
                    <button onClick={() => setLocalGitignore(v => !v)}
                      className={cn('relative w-8 h-4.5 rounded-full transition-colors flex-shrink-0',
                        localGitignore ? 'bg-accent' : 'bg-surface border border-border')}>
                      <span className={cn('absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform',
                        localGitignore ? 'translate-x-4' : 'translate-x-0.5')} />
                    </button>
                    <p className="text-xs text-muted">Add .env to .gitignore automatically</p>
                  </div>
                </div>

                {/* Entries */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] text-muted uppercase tracking-wider">Env Mappings</p>
                    <button onClick={addEntry}
                      className="text-[10px] text-accent hover:text-accent-hover transition-colors">
                      + Add Mapping
                    </button>
                  </div>

                  {localEntries.length === 0 ? (
                    <p className="text-xs text-muted italic py-4">
                      No mappings yet. Add a mapping to connect a secret field to an env variable.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {localEntries.map((entry, i) => (
                        <EntryRow
                          key={i}
                          entry={entry}
                          allSecrets={allSecrets}
                          onChange={e => updateEntry(i, e)}
                          onDelete={() => removeEntry(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {confirmExport && (
                  <div className="mx-5 mb-3 space-y-2 px-3 py-2.5 bg-danger/10 border border-danger/30 rounded-lg flex-shrink-0">
                    <div className="flex items-start gap-2">
                      <svg className="w-3.5 h-3.5 text-danger flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <p className="text-[10px] text-danger">
                        This writes {exportableEntryCount} secret{exportableEntryCount === 1 ? '' : 's'} to plaintext `.env`. Type {PLAINTEXT_CONFIRM_PHRASE}; Touch ID is required on supported Macs before the file is written.
                      </p>
                    </div>
                    <input
                      autoFocus
                      value={confirmText}
                      onChange={e => setConfirmText(e.target.value)}
                      placeholder={PLAINTEXT_CONFIRM_PHRASE}
                      className="w-full bg-surface border border-danger/40 rounded-lg px-2.5 py-1.5 text-xs text-text placeholder-muted outline-none focus:border-danger font-mono"
                    />
                  </div>
                )}

                {/* Footer */}
                <div className="border-t border-border px-5 py-3 flex items-center gap-3 flex-shrink-0">
                  {exportResult && (
                    <p className={cn('text-xs flex-1 truncate', exportResult.ok ? 'text-emerald-400' : 'text-danger')}>
                      {exportResult.msg}
                    </p>
                  )}
                  {!exportResult && <div className="flex-1" />}

                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 rounded-xl text-xs text-muted border border-border hover:text-text hover:border-border/60 disabled:opacity-40 transition-colors">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={handleExport}
                    disabled={!canExport}
                    className={cn(
                      'px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
                      confirmExport
                        ? 'bg-danger/20 border border-danger/50 text-danger hover:bg-danger/30'
                        : 'bg-accent hover:bg-accent-hover text-black'
                    )}>
                    {exporting ? 'Exporting…' : confirmExport ? 'Write .env Unencrypted' : 'Export .env'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
