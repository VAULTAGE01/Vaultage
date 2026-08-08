import { useState } from 'react'
import AuthBackdrop from './AuthBackdrop'
import { SetupPasswordStep } from './SetupPasswordStep'
import { VaultageLogoWordmark } from './VaultageLogo'
import { cn } from '@/lib/utils'
import { openSetupPanelClassName } from './setupScreenStyles'
import EmergencyBackupRestoreScreen from './EmergencyBackupRestoreScreen'

// ── Welcome step ─────────────────────────────────────────────────────────────

function WelcomeStep({ onContinueLocal, onRestore }: { onContinueLocal: () => void; onRestore: () => void }) {
  const localOnly = __VAULTAGE_OPEN_CORE__

  return (
    <>
      <div className={cn(
        'no-drag w-[440px] animate-scale-in relative z-10',
        'max-w-[calc(100vw-32px)] motion-reduce:animate-none',
        __VAULTAGE_OPEN_CORE__ && openSetupPanelClassName,
      )}>
        {/* Header */}
        <div className="text-center mb-7 flex flex-col items-center">
          <VaultageLogoWordmark className="w-64 h-16 text-white mb-3" />
          <p className="text-sm text-text-secondary mt-1">
            Create your local vault
          </p>
        </div>

        {/* Two paths */}
        <div className="space-y-3">
          {/* Local */}
          <button
            className="group w-full rounded-2xl p-5 text-left transition-colors active:scale-[0.99] motion-reduce:active:scale-100"
            onClick={onContinueLocal}
            title="Create your local Vaultage vault. Shortcut: Enter"
            type="button"
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
                  <p className="text-sm font-semibold text-text">
                    Create local vault
                  </p>
                </div>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  {localOnly
                    ? 'Local-first Community. Complete encrypted vault and unlimited local Projects, no signup.'
                    : 'Local-first Free. Complete encrypted vault, unlimited local Projects, and local Agent access, no signup.'}
                </p>
              </div>
              <svg className="w-4 h-4 text-text-secondary mt-2 flex-shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </button>

          {!localOnly && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-xs leading-relaxed text-text-secondary">
              After setup, Account &amp; Plan reports whether optional Services access is available. When enabled, an eligible new account receives one 30-day, no-card Pro trial for Services. Browser-extension access remains deferred and unavailable.
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-[11px] tracking-wide text-text-secondary">
          AES-256-GCM · scrypt · macOS Keychain
        </p>
        <button
          type="button"
          className="mt-3 block w-full text-center text-xs text-muted transition-colors hover:text-text"
          onClick={onRestore}
        >
          Restore an encrypted backup with an Emergency Kit
        </button>
      </div>

    </>
  )
}

// ── Setup screen ─────────────────────────────────────────────────────────────

export default function SetupScreen() {
  const [step, setStep] = useState<'welcome' | 'password' | 'restore'>('welcome')

  return (
    <div className="liquid-shell drag-region relative flex h-screen items-start justify-center overflow-x-hidden overflow-y-auto py-6 sm:items-center">
      <AuthBackdrop />

      {step === 'welcome' && <WelcomeStep onContinueLocal={() => setStep('password')} onRestore={() => setStep('restore')} />}
      {step === 'password' && <SetupPasswordStep onBack={() => setStep('welcome')} />}
      {step === 'restore' && <EmergencyBackupRestoreScreen onBack={() => setStep('welcome')} />}
    </div>
  )
}
