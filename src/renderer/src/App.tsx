import React from 'react'
import { useVault }      from './vaultContext'
import { ModeProvider } from '#mode-context'
import SetupScreen      from './components/SetupScreen'
import AuthScreen       from './components/AuthScreen'
import MainLayout       from '#main-layout'
import { Toaster }      from './components/ui/sonner'

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

  if (state.screen === 'checking')    return null               // brief flash while status IPC resolves
  if (state.screen === 'needs_setup') return <SetupScreen />
  if (state.screen === 'locked')      return <AuthScreen />
  return (
    <>
      <AppErrorBoundary>
        <MainLayout />
      </AppErrorBoundary>
      <Toaster position="bottom-right" />
    </>
  )
}

export default function App() {
  return (
    <ModeProvider>
      <AppInner />
    </ModeProvider>
  )
}
