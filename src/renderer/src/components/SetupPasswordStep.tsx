import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MIN_MASTER_PASSWORD_LENGTH,
  masterPasswordPolicyError,
  masterPasswordStrength,
} from '../../../shared/passwordPolicy'
import { useVault } from '../vaultContext'
import { VaultageLogoWordmark } from './VaultageLogo'
import { SetupSecurityModel } from './SetupSecurityModel'
import type { SetupDestination } from './SetupScreen'

type PasswordStrengthTone = 'neutral' | 'danger' | 'warning' | 'info' | 'success'

function strength(password: string): { score: number; label: string; tone: PasswordStrengthTone } {
  const { score, label } = masterPasswordStrength(password)
  if (!password) return { score: 0, label: '', tone: 'neutral' }
  if (score <= 1) return { score, label: 'Very weak', tone: 'danger' }
  if (score <= 3) return { score, label: score === 2 ? 'Weak' : 'Fair', tone: 'warning' }
  if (score <= 4) return { score, label: 'Strong', tone: 'info' }
  return { score, label: label || 'Very strong', tone: 'success' }
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

function StrengthBar({ score, label, tone }: { score: number; label: string; tone: PasswordStrengthTone }) {
  return (
    <>
      <progress
        aria-label={`Password strength: ${label}`}
        className="ui26-onboarding-strength-native"
        data-ui26-strength-tone={tone}
        max={5}
        value={score}
      />
      <div aria-hidden="true" className="ui26-onboarding-strength-meter" data-ui26-strength-tone={tone}>
        {[1, 2, 3, 4, 5].map(level => (
          <span data-filled={level <= score} key={level} />
        ))}
      </div>
    </>
  )
}

export function SetupPasswordStep({
  destination,
  onBack,
}: {
  readonly destination: SetupDestination
  readonly onBack: () => void
}) {
  const { setup, state } = useVault()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  const passwordStrength = strength(pw)
  const mismatch = confirm.length > 0 && pw !== confirm
  const policyError = pw.length > 0 ? masterPasswordPolicyError(pw, 'Master password') : null
  const ready = pw.length > 0 && !policyError && pw === confirm && !loading
  const passwordDescription = [
    pw.length > 0 ? 'setup-password-strength' : null,
    policyError ? 'setup-password-policy-error' : null,
  ].filter((value): value is string => Boolean(value)).join(' ') || undefined

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  const handleCreate = async () => {
    if (!ready) return
    setLoading(true)
    try {
      await setup(pw)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="no-drag ui26-onboarding-frame ui26-onboarding-frame--password" data-onboarding-step="password">
      <header className="ui26-onboarding-header ui26-onboarding-header--with-back">
        <button
          aria-label="Back"
          className="ui26-onboarding-icon-button ui26-onboarding-back-button"
          data-onboarding-action="back"
          onClick={onBack}
          title="Go back to onboarding choices. Shortcut: Esc"
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        <VaultageLogoWordmark className="ui26-onboarding-wordmark ui26-onboarding-wordmark--form" />
        <h1 className="ui26-onboarding-title">Create your master password</h1>
        <p
          className="ui26-onboarding-subtitle"
          data-onboarding-next={destination}
        >
          {destination === 'account'
            ? 'This protects the key to your local vault. Account & Plan opens after you save the Emergency Kit.'
            : 'This protects the key to your local vault.'}
        </p>
      </header>

      <SetupSecurityModel />

      <div className="ui26-onboarding-form-panel" aria-busy={loading}>
        <div className="ui26-onboarding-field">
          <Label htmlFor="setup-master-password">Master password</Label>
          <div className="ui26-onboarding-input-wrap">
            <Input
              aria-describedby={passwordDescription}
              aria-invalid={Boolean(policyError)}
              autoFocus
              className="ui26-onboarding-input ui26-onboarding-input--with-action"
              data-secure-input="true"
              id="setup-master-password"
              onChange={event => setPw(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && void handleCreate()}
              placeholder={`At least ${MIN_MASTER_PASSWORD_LENGTH} characters`}
              type={show ? 'text' : 'password'}
              value={pw}
            />
            <button
              aria-label={`${show ? 'Hide' : 'Show'} master password fields`}
              aria-pressed={show}
              className="ui26-onboarding-field-action"
              onClick={() => setShow(current => !current)}
              title={`${show ? 'Hide' : 'Show'} master password fields. Shortcut: Enter`}
              type="button"
            >
              <EyeIcon open={show} />
            </button>
          </div>
        </div>

        {pw.length > 0 && (
          <div className="ui26-onboarding-strength" id="setup-password-strength">
            <StrengthBar
              label={passwordStrength.label}
              score={passwordStrength.score}
              tone={passwordStrength.tone}
            />
            <div className="ui26-onboarding-strength-status">
              <p data-ui26-strength-tone={passwordStrength.tone}>{passwordStrength.label}</p>
              <p>{passwordStrength.score}/5</p>
            </div>
            {policyError && (
              <p className="ui26-onboarding-validation" id="setup-password-policy-error">
                {policyError}
              </p>
            )}
          </div>
        )}

        <div className="ui26-onboarding-field">
          <Label htmlFor="setup-confirm-password">Confirm password</Label>
          <Input
            aria-describedby={mismatch ? 'setup-password-mismatch-error' : undefined}
            aria-invalid={mismatch}
            className="ui26-onboarding-input"
            data-secure-input="true"
            id="setup-confirm-password"
            onChange={event => setConfirm(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && void handleCreate()}
            placeholder="Repeat your password"
            type={show ? 'text' : 'password'}
            value={confirm}
          />
          {mismatch && (
            <p className="ui26-onboarding-validation" id="setup-password-mismatch-error">
              Passwords don't match
            </p>
          )}
        </div>

        {state.error && <Alert variant="destructive" className="ui26-onboarding-alert"><AlertDescription>{state.error}</AlertDescription></Alert>}

        <Button
          className="ui26-onboarding-primary-button"
          data-onboarding-action="create-vault"
          data-ui26-tone="primary"
          disabled={!ready}
          onClick={handleCreate}
          title="Create the encrypted local vault. Shortcut: Enter"
          type="button"
        >
          {loading ? 'Creating vault…' : 'Create Vault'}
        </Button>
      </div>

      <aside className="ui26-onboarding-callout ui26-onboarding-callout--warning">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p>
          Vaultage cannot reset this password. Setup creates an offline Emergency Kit next; save it away from this Mac because Vaultage never receives a copy.
        </p>
      </aside>
    </div>
  )
}
