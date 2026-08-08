import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useVault } from '../vaultContext'
import AuthBackdrop from './AuthBackdrop'
import { VaultageLogoWordmark } from './VaultageLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import BackupRestoreScreen from './BackupRestoreScreen'
import EmergencyRecoveryScreen from './EmergencyRecoveryScreen'

type Mode = 'touchid' | 'password'

const TOUCH_ID_RECOVERY_HINT = 'Enter your master password once to turn Touch ID back on for Vaultage.'
const TOUCH_ID_REFRESH_HINT = 'Touch ID no longer opens this vault. Enter your master password once to refresh it.'

function waitForPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function FingerprintIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function AuthScreen() {
  const { state, unlockTouchID, unlockPassword } = useVault()
  const [mode,    setMode]    = useState<Mode>('touchid')
  const [pw,      setPw]      = useState('')
  const [show,    setShow]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [hint,    setHint]    = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [showRestore, setShowRestore] = useState(false)
  const [showEmergencyRecovery, setShowEmergencyRecovery] = useState(false)

  useEffect(() => { setMounted(true); triggerTouchID() }, []) // eslint-disable-line

  const triggerTouchID = async () => {
    if (loading) return
    setMode('touchid')
    setLoading(true)
    setHint(null)
    await waitForPaint()
    const res = await unlockTouchID()
    setLoading(false)
    if (res.cancelled) {
      setHint(null)
    } else if (res.notFound) {
      setMode('password')
      setHint(TOUCH_ID_RECOVERY_HINT)
    } else if (res.touchIdInvalid) {
      setMode('password')
      setHint(TOUCH_ID_REFRESH_HINT)
    } else if (res.authFailed) {
      setHint('Too many failed attempts. Use your master password.')
    }
  }

  const handlePassword = async () => {
    if (!pw || loading) return
    const wasRestoringTouchID = hint === TOUCH_ID_RECOVERY_HINT || hint === TOUCH_ID_REFRESH_HINT
    setLoading(true)
    const res = await unlockPassword(pw)
    setLoading(false)
    if (res.wrongPassword) setPw('')
    else if (res.success && wasRestoringTouchID) {
      if (res.touchIdRestored) toast.success('Touch ID is ready for next time')
      else toast.error('Unlocked, but Touch ID setup needs attention')
    } else if (res.success && res.touchIdRestored === false && window.vault.platform === 'darwin') {
      toast.error('Unlocked, but macOS Keychain did not save Touch ID for next time')
    }
  }

  const isTouchIDMode = mode === 'touchid'
  const isTouchIDPromptOpen = isTouchIDMode && loading
  const isRecoveryHint = hint === TOUCH_ID_RECOVERY_HINT || hint === TOUCH_ID_REFRESH_HINT

  if (showRestore) return <BackupRestoreScreen onCancel={() => setShowRestore(false)} />
  if (showEmergencyRecovery) return <EmergencyRecoveryScreen onCancel={() => setShowEmergencyRecovery(false)} />

  return (
    <div
      className="liquid-shell flex h-screen items-center justify-center drag-region relative overflow-hidden"
      style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.4s ease' }}
    >
      <AuthBackdrop />

      {isTouchIDPromptOpen ? (
        <div
          className="no-drag absolute left-1/2 top-1/2 z-10 flex h-[540px] max-h-[calc(100vh-96px)] w-[390px] -translate-x-1/2 -translate-y-1/2 animate-scale-in flex-col items-center overflow-hidden rounded-[34px] px-8 py-7 text-center transition-all duration-300"
          style={{
            background: 'linear-gradient(180deg, rgba(4,13,10,0.16), rgba(4,13,10,0.23) 46%, rgba(4,13,10,0.42))',
            border: '1px solid rgba(255,255,255,0.09)',
            backdropFilter: 'blur(30px) saturate(170%)',
            WebkitBackdropFilter: 'blur(30px) saturate(170%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 28px 90px rgba(0,0,0,0.24), 0 0 60px rgba(0,255,127,0.06)',
          }}
        >
          <div className="absolute -top-12 h-44 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="pointer-events-none absolute left-1/2 top-[108px] h-[250px] w-[220px] -translate-x-1/2 rounded-[32px] touch-id-prompt-halo" />
          <div className="relative z-10 flex h-full w-full flex-col items-center">
            <VaultageLogoWordmark monochrome className="h-10 w-40 text-white/82" />

            <div className="flex flex-1 flex-col items-center justify-center">
              <div
                className="relative flex h-24 w-24 items-center justify-center rounded-[32px] border"
                style={{
                  background: 'rgba(0,255,127,0.08)',
                  borderColor: 'rgba(0,255,127,0.16)',
                  boxShadow: '0 0 44px rgba(0,255,127,0.16)',
                }}
              >
                <div className="absolute inset-3 rounded-[26px] border border-accent/10" />
                <div className="absolute inset-0 rounded-[32px] border-2 border-accent/20 border-t-accent animate-spin" />
                <FingerprintIcon className="relative h-11 w-11 text-accent" />
              </div>
            </div>

            <div className="pb-2">
              <p className="text-sm font-semibold text-text">Approve the macOS prompt</p>
              <p className="mt-2 max-w-[250px] text-[11px] leading-relaxed text-muted-light">
                Use Touch ID or your Mac password in the system dialog. Cancel there to enter your master password here.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="liquid-card no-drag relative z-10 animate-scale-in p-8 rounded-3xl transition-all duration-300"
          style={{
            width: isTouchIDMode ? 360 : 380,
            background: 'rgba(4,13,10,0.38)',
            border: '1px solid rgba(255,255,255,0.105)',
            backdropFilter: 'blur(30px) saturate(180%)',
            WebkitBackdropFilter: 'blur(30px) saturate(180%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 80px rgba(0,0,0,0.34)',
          }}
        >
          {/* Enlarged SVG Logo */}
          <div className={isTouchIDMode ? 'flex flex-col items-center mb-6' : 'flex flex-col items-center mb-8'}>
            <VaultageLogoWordmark
              monochrome
              className={isTouchIDMode ? 'w-52 h-14 text-white mb-3' : 'w-64 h-16 text-white mb-4'}
            />
            <p className="text-xs text-muted">
              {isTouchIDMode ? 'Ready for Touch ID' : 'Enter your master password'}
            </p>
          </div>

          {/* Hint / error */}
          {(hint || state.error) && (
            <Alert
              variant={isRecoveryHint ? 'default' : state.error ? 'destructive' : 'default'}
              className="mb-5 animate-slide-up"
            >
              <AlertDescription>{hint ?? state.error}</AlertDescription>
            </Alert>
          )}

          {/* Auth content */}
          {mode === 'touchid' ? (
            <div className="flex flex-col items-center gap-4 animate-fade-in text-center">
              <div
                className="relative flex h-16 w-16 items-center justify-center rounded-3xl border"
                style={{
                  background: 'rgba(0,255,127,0.08)',
                  borderColor: 'rgba(0,255,127,0.18)',
                  boxShadow: '0 0 30px rgba(0,255,127,0.12)',
                }}
              >
                {loading ? <Spinner /> : <FingerprintIcon className="w-7 h-7 text-accent" />}
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-text">Unlock with Touch ID</p>
                <p className="mx-auto max-w-[240px] text-[11px] leading-relaxed text-muted">
                  Vaultage asks macOS to confirm it is you before opening the vault.
                </p>
              </div>

	              <button
	                onClick={triggerTouchID}
	                title="Ask macOS to unlock Vaultage with Touch ID. Shortcut: Enter"
	                className="group relative inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 hover:scale-[1.02]"
                style={{
                  background: 'linear-gradient(135deg, #00FF7F, #00CC62)',
                  color: '#000',
                  boxShadow: '0 4px 16px rgba(0,255,127,0.3)',
                }}
              >
                <FingerprintIcon className="w-5 h-5" />
                Use Touch ID
              </button>

              <Button
                variant="link"
                size="sm"
	                onClick={() => { setMode('password'); setHint(null) }}
	                title="Switch to master password unlock. Shortcut: Enter"
	                className="text-xs text-muted hover:text-text-secondary"
              >
                Use master password instead
              </Button>
            </div>
          ) : (
            <div className="space-y-3 animate-slide-up">
              {/* Password input */}
              <div className="relative">
                <Input
                  autoFocus
                  data-secure-input="true"
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePassword()}
                  placeholder="Master password"
                  className="w-full pr-10 py-3 rounded-2xl text-sm h-auto"
                  style={{
                    background: 'rgba(22,22,22,0.8)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(12px)',
                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = 'rgba(0,255,127,0.5)'
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,255,127,0.08)'
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
	                <button
	                  onClick={() => setShow(s => !s)}
	                  title={`${show ? 'Hide' : 'Show'} the master password. Shortcut: Enter`}
	                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-secondary transition-colors"
                  tabIndex={-1}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    {show
                      ? <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /></>
                      : <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    }
                  </svg>
                </button>
              </div>

		              <button
		                onClick={handlePassword}
		                disabled={!pw || loading}
	                title="Unlock the vault with your master password. Shortcut: Enter"
	                className="w-full py-3 rounded-2xl font-semibold text-sm transition-all active:scale-95 hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #00FF7F, #00CC62)',
                  color: '#000',
                  boxShadow: '0 4px 16px rgba(0,255,127,0.3)',
                }}
	              >
	                {loading ? 'Unlocking...' : 'Unlock'}
	              </button>

	              <div className="text-center">
                <Button
                  variant="link"
                  size="sm"
	                  onClick={triggerTouchID}
	                  title="Switch back to Touch ID unlock. Shortcut: Enter"
	                  className="text-xs text-muted hover:text-text-secondary"
                >
                  Use Touch ID instead
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setShowEmergencyRecovery(true)}
                  className="block w-full text-xs text-muted hover:text-text-secondary"
                >
                  Forgot password? Use Emergency Kit
                </Button>
              </div>
            </div>
          )}

          {/* Security note */}
          <p className="mt-8 text-center text-[11px] tracking-wide text-subtle">
            AES-256-GCM · scrypt · macOS Keychain
          </p>
          <div className="mt-2 text-center">
            <Button
              variant="link"
              size="sm"
              className="text-[11px] text-muted hover:text-text-secondary"
              onClick={() => setShowRestore(true)}
            >
              Restore a validated backup
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
