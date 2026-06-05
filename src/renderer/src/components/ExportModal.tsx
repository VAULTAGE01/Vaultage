import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Database,
  FileJson,
  FileText,
  Folder,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'
import { useVault, findFolder, findSecret, flatSecrets } from '../vaultContext'
import type { VaultExportFormat, VaultExportScope } from '../../../shared/vaultExport'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function cn(...cls: (string | false | null | undefined)[]) { return cls.filter(Boolean).join(' ') }

const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT'

interface Props {
  initialScope?: VaultExportScope
  onClose: () => void
}

interface ScopeOption {
  key: string
  label: string
  description: string
  count: number
  scope: VaultExportScope
  icon: typeof Database
}

const FORMAT_OPTIONS: {
  value: VaultExportFormat
  label: string
  description: string
  icon: typeof FileJson
}[] = [
  {
    value: 'encrypted',
    label: 'Encrypted',
    description: 'Password-protected Vaultage export for restore or transfer.',
    icon: LockKeyhole,
  },
  {
    value: 'json',
    label: 'JSON',
    description: 'Plaintext Vaultage JSON, including folders and metadata.',
    icon: FileJson,
  },
  {
    value: 'csv',
    label: 'CSV',
    description: 'Plaintext spreadsheet format. Images are omitted.',
    icon: FileText,
  },
]

function scopeKey(scope: VaultExportScope): string {
  return scope.kind === 'vault' ? 'vault' : `${scope.kind}:${scope.id}`
}

function scopeLabel(scope: VaultExportScope): string {
  if (scope.kind === 'folder') return 'selected folder'
  if (scope.kind === 'secret') return 'selected secret'
  return 'entire vault'
}

export default function ExportModal({ initialScope = { kind: 'vault' }, onClose }: Props) {
  const { state } = useVault()
  const [backupBusy,     setBackupBusy]     = useState(false)
  const [backupResult,   setBackupResult]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [exportBusy,     setExportBusy]     = useState(false)
  const [exportResult,   setExportResult]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirming,     setConfirming]     = useState(false)
  const [confirmText,    setConfirmText]    = useState('')
  const [format,         setFormat]         = useState<VaultExportFormat>('encrypted')
  const [scope,          setScope]          = useState<VaultExportScope>(initialScope)
  const [password,       setPassword]       = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')

  const initialScopeKey = scopeKey(initialScope)

  useEffect(() => {
    setScope(initialScope)
    setConfirming(false)
    setConfirmText('')
    setExportResult(null)
  }, [initialScopeKey])

  const scopeOptions = useMemo(() => {
    if (!state.vault) return []
    const vaultSecretCount = flatSecrets(state.vault.root).length
    const options: ScopeOption[] = [{
      key: 'vault',
      label: 'Entire vault',
      description: `${vaultSecretCount} secret${vaultSecretCount !== 1 ? 's' : ''}, folders, metadata, services, and env links.`,
      count: vaultSecretCount,
      scope: { kind: 'vault' },
      icon: Database,
    }]
    const addFolderOption = (id: string, labelPrefix: string) => {
      const folder = findFolder(state.vault!.root, id)
      if (!folder) return
      const count = flatSecrets(folder).length
      options.push({
        key: `folder:${id}`,
        label: `${labelPrefix}: ${folder.name}`,
        description: `${count} secret${count !== 1 ? 's' : ''} in this folder and its subfolders.`,
        count,
        scope: { kind: 'folder', id },
        icon: Folder,
      })
    }
    const addSecretOption = (id: string, labelPrefix: string) => {
      const found = findSecret(state.vault!.root, id)
      if (!found) return
      options.push({
        key: `secret:${id}`,
        label: `${labelPrefix}: ${found.secret.name}`,
        description: 'One secret with its fields, metadata, and service link.',
        count: 1,
        scope: { kind: 'secret', id },
        icon: KeyRound,
      })
    }

    if (initialScope.kind === 'folder') addFolderOption(initialScope.id, 'Selected folder')
    if (initialScope.kind === 'secret') addSecretOption(initialScope.id, 'Selected secret')
    if (
      state.selectedFolderId &&
      state.selectedFolderId !== state.vault.root.id &&
      scopeKey(initialScope) !== `folder:${state.selectedFolderId}`
    ) {
      addFolderOption(state.selectedFolderId, 'Current folder')
    }
    if (state.selectedSecretId && scopeKey(initialScope) !== `secret:${state.selectedSecretId}`) {
      addSecretOption(state.selectedSecretId, 'Current secret')
    }

    const seen = new Set<string>()
    return options.filter(option => {
      if (seen.has(option.key)) return false
      seen.add(option.key)
      return true
    })
  }, [state.vault, state.selectedFolderId, state.selectedSecretId, initialScope, initialScopeKey])

  const currentScopeKey = scopeKey(scope)
  const selectedScope = scopeOptions.find(option => option.key === currentScopeKey) ?? scopeOptions[0] ?? null
  const encrypted = format === 'encrypted'
  const passwordTooShort = encrypted && password.length > 0 && password.length < 12
  const passwordMismatch = encrypted && passwordRepeat.length > 0 && password !== passwordRepeat
  const canExport = !exportBusy &&
    Boolean(selectedScope) &&
    (encrypted
      ? password.length >= 12 && password === passwordRepeat
      : !confirming || confirmText === PLAINTEXT_CONFIRM_PHRASE)

  const resetExportInputs = (nextFormat: VaultExportFormat) => {
    setFormat(nextFormat)
    setConfirming(false)
    setConfirmText('')
    setPassword('')
    setPasswordRepeat('')
    setExportResult(null)
  }

  const handleBackup = async () => {
    setBackupBusy(true); setBackupResult(null)
    try {
      const res = await window.vault.backup()
      if (res.cancelled) return
      setBackupResult({
        ok:  res.success,
        msg: res.success ? `Backed up to ${res.path}` : (res.error ?? 'Backup failed'),
      })
    } finally {
      setBackupBusy(false)
    }
  }

  const handleExport = async () => {
    if (!selectedScope) return
    if (!encrypted && !confirming) {
      setConfirming(true)
      setConfirmText('')
      return
    }
    if (encrypted && (password.length < 12 || password !== passwordRepeat)) return
    if (!encrypted && confirmText !== PLAINTEXT_CONFIRM_PHRASE) return

    setExportBusy(true); setExportResult(null)
    try {
      const res = await window.vault.exportScope({
        scope: selectedScope.scope,
        format,
        plaintextConfirmation: encrypted ? undefined : confirmText,
        encryptionPassword: encrypted ? password : undefined,
      })
      if (res.cancelled) {
        setConfirming(false)
        setConfirmText('')
        return
      }
      setExportResult({
        ok:  res.success,
        msg: res.success ? `Exported to ${res.path}` : (res.error ?? 'Export failed'),
      })
      if (res.success) {
        setConfirming(false)
        setConfirmText('')
        setPassword('')
        setPasswordRepeat('')
      }
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !exportBusy && !backupBusy) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Export Vault</DialogTitle>
          <DialogDescription>
            Export a secret, a folder, or the whole vault. Encrypted exports are safest for restore and transfer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-4 space-y-5">
          <div className="border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-4 h-4 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-text">Encrypted file backup</p>
                <p className="text-[10px] text-muted mt-1 leading-relaxed">
                  Copies the raw encrypted vault files to a folder. This is the safest disaster-recovery backup and requires your master password to restore.
                </p>
              </div>
            </div>
            {backupResult && (
              <p className={cn('text-[10px] font-mono break-all', backupResult.ok ? 'text-emerald-400' : 'text-danger')}>
                {backupResult.msg}
              </p>
            )}
	            <Button variant="outline" size="sm" onClick={handleBackup} disabled={backupBusy} className="w-full" title="Choose a folder and copy encrypted vault files there. Shortcut: Enter">
              {backupBusy ? 'Backing up...' : 'Choose Folder & Backup'}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-text">Scope</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {scopeOptions.map(option => {
                const Icon = option.icon
                const active = currentScopeKey === option.key
                return (
	                  <button
	                    key={option.key}
	                    type="button"
	                    title={`Export ${option.label}. Shortcut: Enter`}
	                    onClick={() => {
                      setScope(option.scope)
                      setConfirming(false)
                      setConfirmText('')
                      setExportResult(null)
                    }}
                    className={cn(
                      'min-h-[88px] rounded-xl border p-3 text-left transition-colors',
                      active
                        ? 'border-accent/45 bg-accent/10 text-text'
                        : 'border-border bg-surface/70 text-muted hover:text-text hover:border-accent/30',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', active ? 'text-accent' : 'text-muted')} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-text truncate">{option.label}</p>
                        <p className="text-[10px] leading-relaxed mt-1 text-muted">{option.description}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-text">Format</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map(option => {
                const Icon = option.icon
                const active = format === option.value
                return (
	                  <button
	                    key={option.value}
	                    type="button"
	                    title={`Use ${option.label} export format. Shortcut: Enter`}
	                    onClick={() => resetExportInputs(option.value)}
                    className={cn(
                      'min-h-[92px] rounded-xl border p-3 text-left transition-colors',
                      active
                        ? 'border-accent/45 bg-accent/10 text-text'
                        : 'border-border bg-surface/70 text-muted hover:text-text hover:border-accent/30',
                    )}
                  >
                    <Icon className={cn('w-4 h-4 mb-2', active ? 'text-accent' : 'text-muted')} />
                    <p className="text-xs font-semibold text-text">{option.label}</p>
                    <p className="text-[10px] leading-relaxed mt-1 text-muted">{option.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {encrypted ? (
            <div className="rounded-xl border border-border bg-surface/60 p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-text">Export password</p>
                <p className="text-[10px] text-muted mt-1">
                  Use a strong password you can keep separately. Vaultage cannot recover it.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  type="password"
                  data-secure-input="true"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  className={passwordTooShort ? 'border-danger/50 focus:border-danger' : undefined}
                />
                <Input
                  type="password"
                  data-secure-input="true"
                  value={passwordRepeat}
                  onChange={e => setPasswordRepeat(e.target.value)}
                  placeholder="Confirm password"
                  className={passwordMismatch ? 'border-danger/50 focus:border-danger' : undefined}
                />
              </div>
              {(passwordTooShort || passwordMismatch) && (
                <p className="text-[10px] text-danger">
                  {passwordTooShort ? 'Password must be at least 12 characters.' : 'Passwords do not match.'}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-danger">Plaintext export</p>
                  <p className="text-[10px] text-danger/90 mt-1 leading-relaxed">
                    Writes the {selectedScope ? scopeLabel(selectedScope.scope) : 'selection'} as unencrypted {format.toUpperCase()}. Store it securely and delete it after use.
                  </p>
                </div>
              </div>
              {confirming && (
                <Input
                  autoFocus
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={PLAINTEXT_CONFIRM_PHRASE}
                  className="font-mono border-danger/40 focus:border-danger"
                />
              )}
            </div>
          )}

          {exportResult && (
            <p className={cn('text-[10px] font-mono break-all', exportResult.ok ? 'text-emerald-400' : 'text-danger')}>
              {exportResult.msg}
            </p>
          )}
        </div>

        <DialogFooter>
	          <Button variant="outline" size="sm" onClick={onClose} disabled={exportBusy || backupBusy} title="Close export. Shortcut: Esc">Done</Button>
	          <Button
	            size="sm"
	            onClick={handleExport}
	            disabled={!canExport}
	            variant={!encrypted && confirming ? 'destructive' : 'default'}
	            title="Export the selected vault data using the chosen format. Shortcut: Enter"
	          >
            {exportBusy
              ? 'Exporting...'
              : encrypted
                ? `Export Encrypted ${selectedScope ? `(${selectedScope.count})` : ''}`
                : confirming
                  ? 'Yes, Export Unencrypted'
                  : `Export ${format.toUpperCase()}...`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
