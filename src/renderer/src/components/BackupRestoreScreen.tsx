import { useState } from 'react'
import AuthBackdrop from './AuthBackdrop'
import { VaultageLogoWordmark } from './VaultageLogo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function BackupRestoreScreen({
  onCancel,
  recoveryError,
}: {
  onCancel?: () => void
  recoveryError?: string | null
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)

  const canRestore = Boolean(currentPassword && backupPassword && confirmation === 'RESTORE VAULT' && !loading)

  const restore = async () => {
    if (!canRestore) return
    setError(null)
    setLoading(true)
    try {
      const result = await window.vault.restoreBackup({
        currentPassword,
        backupPassword,
        confirmation,
      })
      setCurrentPassword('')
      setBackupPassword('')
      if (result.cancelled) return
      if (!result.success) {
        setError(result.error ?? 'Could not restore this backup')
        return
      }
      setRestored(true)
    } catch (err) {
      setCurrentPassword('')
      setBackupPassword('')
      setError(err instanceof Error ? err.message : 'Could not restore this backup')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="liquid-shell flex h-screen items-center justify-center drag-region relative overflow-hidden p-6">
      <AuthBackdrop />
      <div
        className="liquid-card no-drag relative z-10 w-full max-w-[460px] rounded-3xl p-8"
        style={{
          background: 'rgba(4,13,10,0.50)',
          border: '1px solid rgba(255,255,255,0.105)',
          backdropFilter: 'blur(30px) saturate(180%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 80px rgba(0,0,0,0.34)',
        }}
      >
        <div className="flex flex-col items-center text-center">
          <VaultageLogoWordmark monochrome className="h-12 w-48 text-white" />
          <h1 className="mt-5 text-lg font-semibold text-text">Restore a vault backup</h1>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted">
            Vaultage validates the backup and both passwords before changing any files. Only a backup of this same vault can replace the current state.
          </p>
        </div>

        {recoveryError && (
          <Alert variant="warning" className="mt-5">
            <AlertDescription>{recoveryError}</AlertDescription>
          </Alert>
        )}

        {restored ? (
          <Alert className="mt-6">
            <AlertDescription>
              The backup was restored and Vaultage is restarting. Reopen the app if it does not relaunch automatically.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="mt-6 space-y-4">
            <label className="block space-y-1.5 text-xs text-muted-light">
              <span>Current vault password</span>
              <Input
                autoFocus
                data-secure-input="true"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
                placeholder="Current master password"
              />
            </label>
            <label className="block space-y-1.5 text-xs text-muted-light">
              <span>Backup password</span>
              <Input
                data-secure-input="true"
                type="password"
                autoComplete="off"
                value={backupPassword}
                onChange={event => setBackupPassword(event.target.value)}
                placeholder="Password used by the backup"
              />
            </label>
            <label className="block space-y-1.5 text-xs text-muted-light">
              <span>Type RESTORE VAULT</span>
              <Input
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') void restore() }}
                placeholder="RESTORE VAULT"
                autoComplete="off"
              />
            </label>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3 pt-1">
              {onCancel && (
                <Button variant="outline" className="flex-1" onClick={onCancel} disabled={loading}>
                  Cancel
                </Button>
              )}
              <Button className="flex-1" onClick={() => void restore()} disabled={!canRestore}>
                {loading ? 'Validating…' : 'Choose backup folder'}
              </Button>
            </div>
          </div>
        )}

        <p className="mt-5 text-center text-[11px] leading-relaxed text-subtle">
          Vaultage never accepts an unverified or foreign-vault backup over an existing installation.
        </p>
      </div>
    </div>
  )
}
