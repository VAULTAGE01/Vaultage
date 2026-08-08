import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  MIN_MASTER_PASSWORD_LENGTH,
  masterPasswordPolicyError,
  masterPasswordStrength,
} from '../../../shared/passwordPolicy'
import { useVault } from '../vaultContext'
import { VaultageLogoWordmark } from './VaultageLogo'
import { SetupSecurityModel } from './SetupSecurityModel'
import { openSetupPanelClassName } from './setupScreenStyles'

function strength(password: string): { score: number; label: string; color: string } {
  const { score, label } = masterPasswordStrength(password)
  if (!password) return { score: 0, label: '', color: '#282828' }
  if (score <= 1) return { score, label: 'Very weak', color: '#f43f5e' }
  if (score <= 2) return { score, label: 'Weak', color: '#f97316' }
  if (score <= 3) return { score, label: 'Fair', color: '#eab308' }
  if (score <= 4) return { score, label: 'Strong', color: '#3b82f6' }
  return { score, label: label || 'Very strong', color: '#00FF7F' }
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

function StrengthBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full border border-border/50 bg-surface">
      <div className="h-full rounded-full transition-[width,background-color] duration-500 motion-reduce:transition-none" style={{ width: `${(score / 5) * 100}%`, background: color }} />
    </div>
  )
}

export function SetupPasswordStep({ onBack }: { onBack: () => void }) {
  const { setup, state } = useVault()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  const passwordStrength = strength(pw)
  const mismatch = confirm.length > 0 && pw !== confirm
  const policyError = pw.length > 0 ? masterPasswordPolicyError(pw, 'Master password') : null
  const ready    = pw.length > 0 && !policyError && pw === confirm && !loading

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
    <div className={cn(
      'no-drag w-[520px] max-w-[calc(100vw-32px)] animate-scale-in relative z-10',
      'motion-reduce:animate-none',
      __VAULTAGE_OPEN_CORE__ && openSetupPanelClassName,
    )}>
      <div className="relative mb-4 flex flex-col items-center text-center">
        <button
          aria-label="Back"
          className="absolute left-0 top-1 rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-text"
          onClick={onBack}
          title="Go back to onboarding choices. Shortcut: Esc"
          type="button"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        <VaultageLogoWordmark className="mb-1 h-10 w-40 text-white" />
        <h1 className="text-lg font-semibold tracking-tight text-text">Create your master password</h1>
        <p className="mt-0.5 text-sm text-text-secondary">This protects the key to your local vault</p>
      </div>

      <SetupSecurityModel />

      <div className="space-y-3 rounded-3xl border border-border bg-card/80 p-5 shadow-xl backdrop-blur-xl">
        <div>
          <Label className="mb-1.5 block" htmlFor="setup-master-password">Master password</Label>
          <div className="relative">
            <Input
              autoFocus
              className="h-auto w-full rounded-xl py-2.5 pr-10 text-sm"
              data-secure-input="true"
              id="setup-master-password"
              onChange={event => setPw(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && handleCreate()}
              placeholder={`At least ${MIN_MASTER_PASSWORD_LENGTH} characters`}
              type={show ? 'text' : 'password'}
              value={pw}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text"
              aria-label={`${show ? 'Hide' : 'Show'} master password fields`}
              aria-pressed={show}
              onClick={() => setShow(current => !current)}
              title={`${show ? 'Hide' : 'Show'} master password fields. Shortcut: Enter`}
              type="button"
            >
              <EyeIcon open={show} />
            </button>
          </div>
        </div>

        {pw.length > 0 && (
          <div className="animate-fade-in motion-reduce:animate-none">
            <StrengthBar score={passwordStrength.score} color={passwordStrength.color} />
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-[11px]" style={{ color: passwordStrength.color }}>{passwordStrength.label}</p>
              <p className="text-[11px] text-text-secondary">{passwordStrength.score}/5</p>
            </div>
            {policyError && <p className="mt-1.5 animate-fade-in text-[11px] text-danger motion-reduce:animate-none">{policyError}</p>}
          </div>
        )}

        <div>
          <Label className="mb-1.5 block" htmlFor="setup-confirm-password">Confirm password</Label>
          <Input
            className="h-auto w-full rounded-xl py-2.5 text-sm"
            data-secure-input="true"
            id="setup-confirm-password"
            onChange={event => setConfirm(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && handleCreate()}
            placeholder="Repeat your password"
            type={show ? 'text' : 'password'}
            value={confirm}
          />
          {mismatch && <p className="mt-1.5 animate-fade-in text-[11px] text-danger motion-reduce:animate-none">Passwords don't match</p>}
        </div>

        {state.error && <Alert variant="destructive" className="animate-fade-in motion-reduce:animate-none"><AlertDescription>{state.error}</AlertDescription></Alert>}

        <Button
          className="h-auto w-full rounded-xl py-2.5 text-sm font-semibold motion-reduce:active:scale-100"
          disabled={!ready}
          onClick={handleCreate}
          title="Create the encrypted local vault. Shortcut: Enter"
          type="button"
        >
          {loading ? 'Creating vault…' : 'Create Vault'}
        </Button>
      </div>

      <div className="mt-3 flex gap-2 rounded-2xl border border-warning/20 bg-warning/5 px-4 py-3">
        <svg aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-[11px] leading-relaxed text-muted-light">
          Vaultage cannot reset this password. Setup creates an offline Emergency Kit next; save it away from this Mac because Vaultage never receives a copy.
        </p>
      </div>
    </div>
  )
}
