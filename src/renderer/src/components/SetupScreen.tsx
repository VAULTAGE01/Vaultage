import { useState } from 'react'
import { useVault } from '../vaultContext'
import { AnimatedGradient } from './AnimatedGradient'
import { VaultageLogoWordmark } from './VaultageLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  MIN_MASTER_PASSWORD_LENGTH,
  masterPasswordPolicyError,
  masterPasswordStrength,
} from '../../../shared/passwordPolicy'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

function strength(pw: string): { score: number; label: string; color: string } {
  const { score: s, label } = masterPasswordStrength(pw)
  if (!pw) return { score: 0, label: '', color: '#282828' }
  if (s <= 1) return { score: s, label: 'Very weak',   color: '#f43f5e' }
  if (s <= 2) return { score: s, label: 'Weak',        color: '#f97316' }
  if (s <= 3) return { score: s, label: 'Fair',        color: '#eab308' }
  if (s <= 4) return { score: s, label: 'Strong',      color: '#3b82f6' }
  return              { score: s, label: label || 'Very strong', color: '#00FF7F' }
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

function StrengthBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-surface border border-border/50">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${(score / 5) * 100}%`, background: color }}
      />
    </div>
  )
}

// ── Welcome step ─────────────────────────────────────────────────────────────

function WelcomeStep({ onContinueLocal }: { onContinueLocal: () => void }) {
  const [showAccountSoon, setShowAccountSoon] = useState(false)
  const paidAccountPathEnabled = !__VAULTAGE_OPEN_CORE__

  return (
    <>
      <div className="no-drag w-[440px] animate-scale-in">
        {/* Header */}
        <div className="text-center mb-7 flex flex-col items-center">
          <VaultageLogoWordmark className="w-64 h-16 text-white mb-3" />
          <p className="text-sm text-text-secondary mt-1">Choose how you want to get started</p>
        </div>

        {/* Two paths */}
        <div className="space-y-3">
          {/* Local */}
	          <button
	            onClick={onContinueLocal}
	            title="Start Vaultage in local-first mode without creating an account. Shortcut: Enter"
	            className="w-full text-left p-5 rounded-2xl transition-all active:scale-[0.99] group"
            style={{
              background: 'rgba(0,255,127,0.04)',
              border: '1px solid rgba(0,255,127,0.18)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(0,255,127,0.12)' }}
              >
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text">Continue without account</p>
                  <span className="text-[10px] font-semibold text-accent uppercase tracking-wider">Recommended</span>
                </div>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  Local-first. Your secrets stay encrypted on this Mac. Free forever, no signup.
                </p>
              </div>
              <svg className="w-4 h-4 text-text-secondary mt-2 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </button>

          {paidAccountPathEnabled && (
	            <button
	              onClick={() => setShowAccountSoon(true)}
	              title="Preview the account path planned for paid sync and team features. Shortcut: Enter"
	              className="w-full text-left p-5 rounded-2xl transition-all active:scale-[0.99] opacity-80 hover:opacity-100"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(56,189,248,0.10)' }}
                >
                  <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text">Continue with account</p>
                    <span
                      className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                      style={{
                        color: '#7dd3fc',
                        background: 'rgba(56,189,248,0.08)',
                        border: '1px solid rgba(56,189,248,0.2)',
                      }}
                    >
                      Coming soon
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Planned for paid sync, team, and hosted workflow features.
                  </p>
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] mt-6 text-subtle tracking-wide">
          AES-256-GCM · scrypt · macOS Keychain
        </p>
      </div>

      {/* Account coming-soon dialog */}
      {paidAccountPathEnabled && (
        <Dialog open={showAccountSoon} onOpenChange={setShowAccountSoon}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Accounts are coming soon</DialogTitle>
              <DialogDescription className="text-sm text-text-secondary leading-relaxed pt-1">
                For now, continue without an account. You'll be able to create an account
                for paid sync, team, and hosted workflow features once they launch at{' '}
                <span className="text-sky-400 font-medium">vaultage.dev</span>.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
	              <Button size="sm" onClick={() => setShowAccountSoon(false)} title="Close this message. Shortcut: Esc">
                OK
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ── Password step ────────────────────────────────────────────────────────────

function PasswordStep({ onBack }: { onBack: () => void }) {
  const { setup, state } = useVault()
  const [pw,      setPw]      = useState('')
  const [confirm, setConfirm] = useState('')
  const [show,    setShow]    = useState(false)
  const [loading, setLoading] = useState(false)

  const str      = strength(pw)
  const mismatch = confirm.length > 0 && pw !== confirm
  const policyError = pw.length > 0 ? masterPasswordPolicyError(pw, 'Master password') : null
  const ready    = !policyError && pw === confirm && !loading

  const handleCreate = async () => {
    if (!ready) return
    setLoading(true)
    await setup(pw)
    setLoading(false)
  }

  return (
    <div className="no-drag w-[400px] animate-scale-in">
      {/* Header with back */}
      <div className="text-center mb-7 relative flex flex-col items-center">
	        <button
	          onClick={onBack}
	          title="Go back to onboarding choices. Shortcut: Esc"
	          className="absolute left-0 top-1 p-1.5 rounded-lg text-text-secondary hover:text-text hover:bg-white/5 transition-colors"
          aria-label="Back"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        <VaultageLogoWordmark className="w-48 h-12 text-white mb-3" />
        <h1 className="text-lg font-semibold text-text tracking-tight mt-2">Create your master password</h1>
        <p className="text-sm text-text-secondary mt-1">This encrypts your local vault</p>
      </div>

      {/* Form */}
      <div
        className="rounded-3xl p-6 space-y-4"
        style={{
          background: 'rgba(18,18,18,0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Password */}
        <div>
          <Label className="block mb-1.5">Master password</Label>
          <div className="relative">
            <Input
              autoFocus
              data-secure-input="true"
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder={`At least ${MIN_MASTER_PASSWORD_LENGTH} characters`}
              className="w-full py-2.5 rounded-xl text-sm pr-10 h-auto"
            />
	            <button
	              onClick={() => setShow(s => !s)}
	              title={`${show ? 'Hide' : 'Show'} master password fields. Shortcut: Enter`}
	              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text"
              tabIndex={-1}
            >
              <EyeIcon open={show} />
            </button>
          </div>
        </div>

        {pw.length > 0 && (
          <div className="animate-fade-in">
            <StrengthBar score={str.score} color={str.color} />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px]" style={{ color: str.color }}>{str.label}</p>
              <p className="text-[11px] text-text-secondary">{str.score}/5</p>
            </div>
            {policyError && (
              <p className="text-[11px] text-danger mt-1.5 animate-fade-in">{policyError}</p>
            )}
          </div>
        )}

        {/* Confirm */}
        <div>
          <Label className="block mb-1.5">Confirm password</Label>
          <Input
            data-secure-input="true"
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Repeat your password"
            className="w-full py-2.5 rounded-xl text-sm h-auto"
          />
          {mismatch && (
            <p className="text-[11px] text-danger mt-1.5 animate-fade-in">Passwords don't match</p>
          )}
        </div>

        {state.error && (
          <Alert variant="destructive" className="animate-fade-in">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

	        <Button
	          onClick={handleCreate}
	          disabled={!ready}
	          title="Create the encrypted local vault. Shortcut: Enter"
	          className="w-full py-2.5 rounded-xl font-semibold text-sm h-auto"
          style={{
            background: ready ? 'linear-gradient(135deg, #00FF7F, #00CC62)' : 'rgba(0,255,127,0.3)',
            color: '#000',
            boxShadow: ready ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
          }}
        >
          {loading ? 'Creating vault…' : 'Create Vault'}
        </Button>
      </div>

      {/* Warning */}
      <div
        className="mt-4 flex gap-3 p-4 rounded-2xl animate-fade-in"
        style={{
          background: 'rgba(234,179,8,0.05)',
          border: '1px solid rgba(234,179,8,0.15)',
        }}
      >
        <svg className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-[12px] text-muted-light leading-relaxed">
          Your master password <strong className="text-text font-medium">cannot be recovered</strong>.
          If you forget it, your vault is permanently inaccessible. Write it down and store it securely.
        </p>
      </div>
    </div>
  )
}

// ── Setup screen ─────────────────────────────────────────────────────────────

export default function SetupScreen() {
  const [step, setStep] = useState<'welcome' | 'password'>('welcome')

  return (
    <div className="liquid-shell flex h-screen items-center justify-center drag-region relative overflow-hidden">
      <AnimatedGradient
        variant="vortex"
        speed={0.18}
        opacity={0.74}
        className="absolute inset-0 pointer-events-none"
      />
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,rgba(2,8,6,0.56)_0%,rgba(2,8,6,0.34)_45%,rgba(2,8,6,0.68)_100%)]" />
      <div className="liquid-noise absolute inset-0 pointer-events-none opacity-30" />

      {step === 'welcome'
        ? <WelcomeStep onContinueLocal={() => setStep('password')} />
        : <PasswordStep onBack={() => setStep('welcome')} />}
    </div>
  )
}
