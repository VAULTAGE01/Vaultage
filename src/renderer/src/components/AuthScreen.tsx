import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useVault } from '../vaultContext'
import AuthBackdrop from './AuthBackdrop'
import { VaultageLogoWordmark } from './VaultageLogo'
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
      className={`ui26-auth-shell drag-region${mounted ? ' is-mounted' : ''}`}
    >
      <AuthBackdrop />

      {isTouchIDPromptOpen ? (
        <section className="ui26-auth-panel ui26-auth-prompt no-drag" aria-live="polite">
          <VaultageLogoWordmark monochrome className="ui26-auth-wordmark" />
          <div className="ui26-auth-icon is-prompt"><Spinner /></div>
          <div className="ui26-auth-copy">
            <h1>Approve the macOS prompt</h1>
            <p>Use Touch ID or your Mac password in the system dialog. Cancel there to enter your master password here.</p>
          </div>
        </section>
      ) : (
        <section className="ui26-auth-panel no-drag">
          <header className="ui26-auth-header">
            <VaultageLogoWordmark
              monochrome
              className="ui26-auth-wordmark"
            />
            <p>
              {isTouchIDMode ? 'Ready for Touch ID' : 'Enter your master password'}
            </p>
          </header>

          {(hint || state.error) && (
            <p className={`ui26-auth-alert${state.error && !isRecoveryHint ? ' is-danger' : ''}`} role="alert">
              {hint ?? state.error}
            </p>
          )}

          {mode === 'touchid' ? (
            <div className="ui26-auth-content">
              <div className="ui26-auth-icon">
                {loading ? <Spinner /> : <FingerprintIcon />}
              </div>
              <div className="ui26-auth-copy">
                <h1>Unlock with Touch ID</h1>
                <p>Vaultage asks macOS to confirm it is you before opening the vault.</p>
              </div>
              <button type="button" onClick={triggerTouchID} title="Ask macOS to unlock Vaultage with Touch ID. Shortcut: Enter" className="ui26-button ui26-auth-primary">
                <FingerprintIcon />
                Use Touch ID
              </button>
              <button type="button" onClick={() => { setMode('password'); setHint(null) }} title="Switch to master password unlock. Shortcut: Enter" className="ui26-auth-link">
                Use master password instead
              </button>
            </div>
          ) : (
            <div className="ui26-auth-content is-password">
              <label className="ui26-auth-field">
                <span>Master password</span>
                <span className="ui26-auth-input-wrap">
                  <input
                  autoFocus
                  data-secure-input="true"
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePassword()}
                  placeholder="Master password"
                  className="ui26-auth-input"
                />
                  <button type="button" onClick={() => setShow(s => !s)} title={`${show ? 'Hide' : 'Show'} the master password. Shortcut: Enter`} className="ui26-auth-reveal" aria-label={`${show ? 'Hide' : 'Show'} master password`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    {show
                      ? <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /></>
                      : <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    }
                  </svg>
                  </button>
                </span>
              </label>
              <button type="button" onClick={handlePassword} disabled={!pw || loading} title="Unlock the vault with your master password. Shortcut: Enter" className="ui26-button ui26-auth-primary">
                {loading ? 'Unlocking...' : 'Unlock'}
              </button>
              <div className="ui26-auth-links">
                <button type="button" onClick={triggerTouchID} title="Switch back to Touch ID unlock. Shortcut: Enter" className="ui26-auth-link">
                  Use Touch ID instead
                </button>
                <button type="button" onClick={() => setShowEmergencyRecovery(true)} className="ui26-auth-link">
                  Forgot password? Use Emergency Kit
                </button>
              </div>
            </div>
          )}

          <p className="ui26-auth-security">
            AES-256-GCM · scrypt · macOS Keychain
          </p>
          <button type="button" className="ui26-auth-link" onClick={() => setShowRestore(true)}>
            Restore a validated backup
          </button>
        </section>
      )}
    </div>
  )
}
