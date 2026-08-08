import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { masterPasswordPolicyError } from '../../../shared/passwordPolicy'
import { useVault } from '../vaultContext'
import AuthBackdrop from './AuthBackdrop'
import { VaultageLogoWordmark } from './VaultageLogo'

export default function EmergencyRecoveryScreen({ onCancel }: { onCancel: () => void }) {
  const { recoverWithKit } = useVault()
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const policyError = newPassword ? masterPasswordPolicyError(newPassword, 'New master password') : null
  const mismatch = confirmation.length > 0 && confirmation !== newPassword
  const ready = Boolean(recoveryCode && newPassword && !policyError && !mismatch && confirmation && !busy)

  const recover = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const result = await recoverWithKit({ recoveryCode, newPassword })
      if (!result.success) {
        const wait = result.retryAfterMs ? ` Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.` : ''
        throw new Error(`${result.error ?? 'The Emergency Kit could not unlock this vault.'}${wait}`)
      }
    } catch (reason) {
      setRecoveryCode('')
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="liquid-shell drag-region relative flex h-screen items-center justify-center overflow-y-auto p-6">
      <AuthBackdrop />
      <div className="no-drag relative z-10 w-full max-w-[620px] rounded-3xl border border-border bg-bg/90 p-6 shadow-2xl backdrop-blur-2xl sm:p-8">
        <div className="flex flex-col items-center text-center">
          <VaultageLogoWordmark monochrome className="h-11 w-44 text-white" />
          <h1 className="mt-4 text-lg font-semibold text-text">Recover with your Emergency Kit</h1>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-muted">
            The code unlocks this exact local vault and replaces the forgotten master password. It does not use your Vaultage account, email, or support.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <Label htmlFor="emergency-recovery-code">Emergency Kit code</Label>
            <Input
              autoFocus
              autoComplete="off"
              className="mt-1.5 font-mono text-xs"
              data-secure-input="true"
              id="emergency-recovery-code"
              placeholder="VLT1-…"
              value={recoveryCode}
              onChange={event => { setRecoveryCode(event.target.value); setError(null) }}
            />
          </label>
          <label>
            <Label htmlFor="emergency-new-password">New master password</Label>
            <Input
              autoComplete="new-password"
              className="mt-1.5"
              data-secure-input="true"
              id="emergency-new-password"
              type="password"
              value={newPassword}
              onChange={event => { setNewPassword(event.target.value); setError(null) }}
            />
          </label>
          <label>
            <Label htmlFor="emergency-confirm-password">Confirm new password</Label>
            <Input
              autoComplete="new-password"
              className="mt-1.5"
              data-secure-input="true"
              id="emergency-confirm-password"
              type="password"
              value={confirmation}
              onChange={event => { setConfirmation(event.target.value); setError(null) }}
              onKeyDown={event => { if (event.key === 'Enter') void recover() }}
            />
          </label>
        </div>

        {(policyError || mismatch || error) && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error ?? policyError ?? "Passwords don't match"}</AlertDescription>
          </Alert>
        )}

        <Alert variant="warning" className="mt-4">
          <AlertDescription>
            Successful recovery revokes this code on the active vault and creates a replacement kit that you must save and verify.
          </AlertDescription>
        </Alert>

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={() => { void recover() }} disabled={!ready}>{busy ? 'Recovering…' : 'Recover vault'}</Button>
        </div>
      </div>
    </div>
  )
}
