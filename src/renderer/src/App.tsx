import React from 'react'
import { useVault }      from './vaultContext'
import { ModeProvider } from '#mode-context'
import SetupScreen      from './components/SetupScreen'
import AuthScreen       from './components/AuthScreen'
import BackupRestoreScreen from './components/BackupRestoreScreen'
import MainLayout       from '#main-layout'
import MenuBarPanel     from './components/MenuBarPanel'
import { Toaster }      from './components/ui/sonner'
import CommercialReadiness from '#commercial-readiness'
import { CommercialAccountProvider } from '#commercial-account'

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-bg text-text flex items-center justify-center p-8">
          <div className="max-w-lg rounded-2xl border border-danger/25 bg-surface p-5 shadow-card">
            <p className="text-sm font-semibold text-danger">Vaultage hit a renderer error</p>
            <p className="mt-2 text-xs text-text-secondary leading-relaxed">
              Lock and reopen Vaultage. If this repeats, the error below can help debug the bad screen state.
            </p>
            <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-black/20 p-3 text-[11px] text-muted">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function AppInner() {
  const { state } = useVault()

  if (state.screen === 'checking')    return (
    <div className="liquid-shell flex h-screen items-center justify-center text-sm text-muted">
      Checking vault integrity…
    </div>
  )
  if (state.screen === 'needs_setup') return <SetupScreen />
  if (state.screen === 'recovery')    return <BackupRestoreScreen recoveryError={state.error} />
  if (state.screen === 'locked')      return <AuthScreen />
  return (
    <CommercialAccountProvider>
      <AppErrorBoundary>
        <MainLayout />
      </AppErrorBoundary>
      <Toaster position="bottom-right" />
      <CommercialReadiness />
    </CommercialAccountProvider>
  )
}

export default function App() {
  if (new URLSearchParams(window.location.search).get('surface') === 'menu-bar') {
    return <MenuBarPanel />
  }

  return (
    <ModeProvider>
      <AppInner />
    </ModeProvider>
  )
}
