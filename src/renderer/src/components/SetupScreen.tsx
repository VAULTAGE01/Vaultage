import { useState, type ReactNode } from 'react'
import { UserRoundPlus } from 'lucide-react'
import '../ui2026/ui2026.css'
import '../ui2026/onboarding.css'
import AuthBackdrop from './AuthBackdrop'
import { SetupPasswordStep } from './SetupPasswordStep'
import { VaultageLogoWordmark } from './VaultageLogo'
import EmergencyBackupRestoreScreen from './EmergencyBackupRestoreScreen'
import { useCommercialSetupAccount } from '#commercial-setup-account'

export type SetupDestination = 'vault' | 'account'

interface WelcomeActionProps {
  readonly action: string
  readonly description: string
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly tone: 'primary' | 'secondary'
}

function WelcomeAction({ action, description, disabled = false, icon, label, onClick, tone }: WelcomeActionProps) {
  return (
    <button
      className="ui26-onboarding-action-card"
      data-onboarding-action={action}
      data-ui26-tone={tone}
      disabled={disabled}
      onClick={onClick}
      title={`${label}. Shortcut: Enter`}
      type="button"
    >
      <span className="ui26-onboarding-action-layout">
        <span className="ui26-onboarding-action-icon">{icon}</span>
        <span className="ui26-onboarding-action-copy">
          <strong>{label}</strong>
          <span>{description}</span>
        </span>
        <svg aria-hidden="true" className="ui26-onboarding-action-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </span>
    </button>
  )
}

interface WelcomeStepProps {
  readonly accountStatus: 'signed-out' | 'signed-in' | 'reauthentication-required'
  readonly accountAvailable: boolean
  readonly accountError: string | null
  readonly accountLoading: boolean
  readonly accountOperation: string | null
  readonly onCancelAuthentication: () => void
  readonly onContinueAccount: () => void
  readonly onCreateAccount: () => void
  readonly onContinueLocal: () => void
  readonly onRestore: () => void
  readonly onSignIn: () => void
}

function WelcomeStep({
  accountStatus,
  accountAvailable,
  accountError,
  accountLoading,
  accountOperation,
  onCancelAuthentication,
  onContinueAccount,
  onCreateAccount,
  onContinueLocal,
  onRestore,
  onSignIn,
}: WelcomeStepProps) {
  const localOnly = __VAULTAGE_OPEN_CORE__
  const accountBusy = accountOperation === 'create-account' || accountOperation === 'sign-in'

  return (
    <div className="no-drag ui26-onboarding-frame ui26-onboarding-frame--welcome" data-onboarding-step="welcome">
      <header className="ui26-onboarding-header">
        <VaultageLogoWordmark className="ui26-onboarding-wordmark ui26-onboarding-wordmark--welcome" />
        <h1 className="ui26-onboarding-title">
          {localOnly ? 'Create your local vault' : 'Start with your Vaultage account'}
        </h1>
        <p className="ui26-onboarding-subtitle">
          {localOnly
            ? 'Private by default, ready in a few steps.'
            : 'Account access for plan and Services. Your encrypted vault stays local to this Mac.'}
        </p>
      </header>

      <div className="ui26-onboarding-paths">
        {!localOnly && accountStatus === 'signed-in' && (
          <WelcomeAction
            action="continue-account"
            description="Continue with this account, then create the encrypted local vault and Emergency Kit for this Mac."
            icon={<UserRoundPlus aria-hidden="true" strokeWidth={1.75} />}
            label="Continue with your account"
            onClick={onContinueAccount}
            tone="primary"
          />
        )}

        {!localOnly && accountStatus !== 'signed-in' && (
          <>
            <WelcomeAction
              action="create-account"
              description="Open secure browser signup, then create the encrypted local vault and Emergency Kit for this Mac."
              disabled={!accountAvailable || accountLoading || accountBusy}
              icon={<UserRoundPlus aria-hidden="true" strokeWidth={1.75} />}
              label={accountOperation === 'create-account' ? 'Creating account…' : 'Create Vaultage account'}
              onClick={onCreateAccount}
              tone="primary"
            />
            <WelcomeAction
              action="sign-in"
              description="Use an existing account for plan and Services. This does not download or unlock a local vault."
              disabled={!accountAvailable || accountLoading || accountBusy}
              icon={<UserRoundPlus aria-hidden="true" strokeWidth={1.75} />}
              label={accountOperation === 'sign-in' ? 'Signing in…' : 'Sign in to your account'}
              onClick={onSignIn}
              tone="secondary"
            />
          </>
        )}

        <WelcomeAction
          action="create-local"
          description={localOnly
            ? 'Local-first Community. Complete encrypted vault and unlimited local Projects, no signup.'
            : 'Use Vaultage locally without an account. You can connect an account later from Account & Plan.'}
          icon={(
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25z" />
            </svg>
          )}
          label={localOnly ? 'Create local vault' : 'Use Vaultage locally'}
          onClick={onContinueLocal}
          tone={localOnly ? 'primary' : 'secondary'}
        />

        {!localOnly && (
          <aside className="ui26-onboarding-note">
            {accountError
              ? <span role="alert">{accountError} You can continue locally and connect later.</span>
              : accountLoading
                ? 'Checking secure account access…'
                : !accountAvailable
                  ? 'Online account access is unavailable in this build or while the service is offline. Local Vault and Projects remain available.'
                  : 'An eligible new account receives one 30-day, no-card Pro trial for Services. Account recovery never unlocks the encrypted local vault. Browser-extension access remains deferred and unavailable.'}
            {accountBusy && (
              <button className="ui26-onboarding-link" type="button" onClick={onCancelAuthentication}>
                Cancel browser authentication
              </button>
            )}
          </aside>
        )}
      </div>

      <footer className="ui26-onboarding-footer">
        <p className="ui26-onboarding-metadata">AES-256-GCM · scrypt · macOS Keychain</p>
        <button data-onboarding-action="restore" type="button" className="ui26-onboarding-link" onClick={onRestore}>
          Restore an encrypted backup with an Emergency Kit
        </button>
      </footer>
    </div>
  )
}

export default function SetupScreen({
  onSetupDestination,
}: {
  readonly onSetupDestination: (destination: SetupDestination) => void
}) {
  const account = useCommercialSetupAccount()
  const [step, setStep] = useState<'welcome' | 'password' | 'restore'>('welcome')
  const [destination, setDestination] = useState<SetupDestination>('vault')

  const continueSetup = (nextDestination: SetupDestination) => {
    setDestination(nextDestination)
    onSetupDestination(nextDestination)
    setStep('password')
  }

  const authenticateThenSetup = async (action: () => Promise<void>) => {
    account.clearError()
    try {
      await action()
      continueSetup('account')
    } catch {
      // The account context exposes only a stable redacted error for this screen.
    }
  }

  return (
    <div className="liquid-shell drag-region ui26-onboarding-shell" data-onboarding-current-step={step}>
      <AuthBackdrop intent="onboarding" />

      {step === 'welcome' && (
        <WelcomeStep
          accountStatus={account.accountStatus}
          accountAvailable={account.available}
          accountError={account.error}
          accountLoading={account.loading}
          accountOperation={account.operation}
          onCancelAuthentication={() => { void account.cancelAuthentication() }}
          onContinueAccount={() => continueSetup('account')}
          onCreateAccount={() => { void authenticateThenSetup(account.createAccount) }}
          onContinueLocal={() => continueSetup('vault')}
          onRestore={() => setStep('restore')}
          onSignIn={() => { void authenticateThenSetup(account.signIn) }}
        />
      )}
      {step === 'password' && (
        <SetupPasswordStep
          destination={destination}
          onBack={() => setStep('welcome')}
        />
      )}
      {step === 'restore' && <EmergencyBackupRestoreScreen onBack={() => setStep('welcome')} />}
    </div>
  )
}
