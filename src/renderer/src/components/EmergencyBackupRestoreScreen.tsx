import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { masterPasswordPolicyError } from '../../../shared/passwordPolicy'
import { useVault } from '../vaultContext'
import { VaultageLogoWordmark } from './VaultageLogo'

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
  const validationId = error
    ? 'restore-backup-error'
    : policyError
      ? 'restore-password-policy-error'
      : mismatch
        ? 'restore-password-mismatch-error'
        : undefined

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

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
    <div className="no-drag ui26-onboarding-frame ui26-onboarding-frame--restore" data-onboarding-step="restore">
      <Button className="ui26-onboarding-restore-back" data-onboarding-action="back" onClick={onBack} size="sm" type="button" variant="ghost">
        ← Back
      </Button>
      <header className="ui26-onboarding-header">
        <VaultageLogoWordmark monochrome className="ui26-onboarding-wordmark ui26-onboarding-wordmark--form" />
        <h1 className="ui26-onboarding-title">Restore on this Mac</h1>
        <p className="ui26-onboarding-copy">
          Choose an encrypted Vaultage backup and use its Emergency Kit code. Vaultage validates the exact vault binding before writing local files.
        </p>
      </header>

      <div className="ui26-onboarding-restore-grid">
        <div className="ui26-onboarding-field ui26-onboarding-field--wide">
          <Label htmlFor="restore-kit-code">Emergency Kit code</Label>
          <Input id="restore-kit-code" autoFocus autoComplete="off" data-secure-input="true" className="ui26-onboarding-input ui26-onboarding-input--mono" placeholder="VLT1-…" value={recoveryCode} onChange={event => { setRecoveryCode(event.target.value); setError(null) }} />
        </div>
        <div className="ui26-onboarding-field">
          <Label htmlFor="restore-new-password">New master password</Label>
          <Input aria-describedby={policyError ? validationId : undefined} aria-invalid={Boolean(policyError)} id="restore-new-password" autoComplete="new-password" data-secure-input="true" className="ui26-onboarding-input" type="password" value={newPassword} onChange={event => { setNewPassword(event.target.value); setError(null) }} />
        </div>
        <div className="ui26-onboarding-field">
          <Label htmlFor="restore-confirm-password">Confirm new password</Label>
          <Input aria-describedby={mismatch ? validationId : undefined} aria-invalid={mismatch} id="restore-confirm-password" autoComplete="new-password" data-secure-input="true" className="ui26-onboarding-input" type="password" value={passwordConfirmation} onChange={event => { setPasswordConfirmation(event.target.value); setError(null) }} />
        </div>
        <div className="ui26-onboarding-field ui26-onboarding-field--wide">
          <Label htmlFor="restore-confirmation">Type RESTORE VAULT</Label>
          <Input id="restore-confirmation" autoComplete="off" className="ui26-onboarding-input ui26-onboarding-input--mono" placeholder="RESTORE VAULT" value={restoreConfirmation} onChange={event => setRestoreConfirmation(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void restore() }} />
        </div>
      </div>

      {(policyError || mismatch || error) && <Alert id={validationId} variant="destructive" className="ui26-onboarding-alert"><AlertDescription>{error ?? policyError ?? "Passwords don't match"}</AlertDescription></Alert>}
      <Alert variant="warning" className="ui26-onboarding-alert"><AlertDescription>The backup folder and code must belong to the same vault. Recovery creates a replacement kit after restore.</AlertDescription></Alert>
      <div className="ui26-onboarding-restore-actions"><Button className="ui26-onboarding-restore-submit" data-onboarding-action="choose-backup" data-ui26-tone="primary" onClick={() => { void restore() }} disabled={!ready}>{busy ? 'Validating…' : 'Choose encrypted backup'}</Button></div>
    </div>
  )
}
