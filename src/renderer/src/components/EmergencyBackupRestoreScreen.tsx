import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { masterPasswordPolicyError } from '../../../shared/passwordPolicy'
import { useVault } from '../vaultContext'
import { VaultageLogoWordmark } from './VaultageLogo'
import { cn } from '@/lib/utils'
import { openSetupPanelClassName } from './setupScreenStyles'

export default function EmergencyBackupRestoreScreen({ onBack }: { onBack: () => void }) {
  const { restoreBackupWithKit } = useVault()
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const policyError = newPassword ? masterPasswordPolicyError(newPassword, 'New master password') : null
  const mismatch = passwordConfirmation.length > 0 && passwordConfirmation !== newPassword
  const ready = Boolean(
    recoveryCode && newPassword && passwordConfirmation && !policyError && !mismatch
      && restoreConfirmation === 'RESTORE VAULT' && !busy,
  )

  const restore = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const result = await restoreBackupWithKit({
        recoveryCode,
        newPassword,
        confirmation: restoreConfirmation,
      })
      if (result.cancelled) return
      if (!result.success) {
        const wait = result.retryAfterMs ? ` Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.` : ''
        throw new Error(`${result.error ?? 'The encrypted backup could not be restored.'}${wait}`)
      }
    } catch (reason) {
      setRecoveryCode('')
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn(
      'no-drag relative z-10 w-[660px] max-w-[calc(100vw-32px)] rounded-3xl border border-border bg-bg/90 p-6 shadow-2xl backdrop-blur-2xl',
      __VAULTAGE_OPEN_CORE__ && openSetupPanelClassName,
    )}>
      <button type="button" aria-label="Back" className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-text" onClick={onBack}>← Back</button>
      <div className="flex flex-col items-center text-center">
        <VaultageLogoWordmark monochrome className="h-10 w-40 text-white" />
        <h1 className="mt-3 text-lg font-semibold text-text">Restore on this Mac</h1>
        <p className="mt-2 max-w-lg text-xs leading-relaxed text-muted">
          Choose an encrypted Vaultage backup and use its Emergency Kit code. Vaultage validates the exact vault binding before writing local files.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <Label htmlFor="restore-kit-code">Emergency Kit code</Label>
          <Input id="restore-kit-code" autoFocus autoComplete="off" data-secure-input="true" className="mt-1 font-mono text-xs" placeholder="VLT1-…" value={recoveryCode} onChange={event => { setRecoveryCode(event.target.value); setError(null) }} />
        </label>
        <label>
          <Label htmlFor="restore-new-password">New master password</Label>
          <Input id="restore-new-password" autoComplete="new-password" data-secure-input="true" className="mt-1" type="password" value={newPassword} onChange={event => { setNewPassword(event.target.value); setError(null) }} />
        </label>
        <label>
          <Label htmlFor="restore-confirm-password">Confirm new password</Label>
          <Input id="restore-confirm-password" autoComplete="new-password" data-secure-input="true" className="mt-1" type="password" value={passwordConfirmation} onChange={event => { setPasswordConfirmation(event.target.value); setError(null) }} />
        </label>
        <label className="sm:col-span-2">
          <Label htmlFor="restore-confirmation">Type RESTORE VAULT</Label>
          <Input id="restore-confirmation" autoComplete="off" className="mt-1 font-mono" placeholder="RESTORE VAULT" value={restoreConfirmation} onChange={event => setRestoreConfirmation(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void restore() }} />
        </label>
      </div>

      {(policyError || mismatch || error) && <Alert variant="destructive" className="mt-4"><AlertDescription>{error ?? policyError ?? "Passwords don't match"}</AlertDescription></Alert>}
      <Alert variant="warning" className="mt-4"><AlertDescription>The backup folder and code must belong to the same vault. Recovery creates a replacement kit after restore.</AlertDescription></Alert>
      <div className="mt-4 flex justify-end"><Button onClick={() => { void restore() }} disabled={!ready}>{busy ? 'Validating…' : 'Choose encrypted backup'}</Button></div>
    </div>
  )
}
