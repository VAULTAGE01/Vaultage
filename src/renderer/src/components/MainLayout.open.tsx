import { useEffect, useState } from 'react'
import { useVault } from '../vaultContext'
import { useMode } from '../modeContext.open'
import { isModKey } from '../lib/keyboard'
import Sidebar from './Sidebar.open'
import SecretDetail, { LocalDashboard } from './SecretDetail.open'
import GlobalSearch from './GlobalSearch'
import ProjectsView from './ProjectsView.open'
import CommunityOnboardingResearchPrompt from './OnboardingResearchPrompt.open'
import { OPEN_SHELL_BACKGROUND_CONTRACT } from '../lib/editionTheme'
import { ApplicationShell } from './ApplicationShell'
import { isUi2026Enabled } from '../ui2026/flags'
import VaultSurface from '../ui2026/surfaces/VaultSurface.open'

export type AppView = 'dashboard' | 'folders'

function MainContentDragStrip() {
  return <div aria-hidden className="main-content-drag-strip drag-region absolute left-0 right-0 top-0 z-10 h-3" />
}

export default function MainLayout(_props: {
  readonly initialSetupDestination?: string
}) {
  const { lock } = useVault()
  const { mode, setMode, setSelectedProjectId } = useMode()
  const [showSearch, setShowSearch] = useState(false)
  const [view, setView] = useState<AppView>('dashboard')
  const shellBackground = OPEN_SHELL_BACKGROUND_CONTRACT
  const showUi2026Vault = mode === 'local'
    && view === 'dashboard'
    && isUi2026Enabled('vault')

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isModKey(event)) return
      const key = event.key.toLowerCase()
      if (key === 'k' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        setShowSearch(open => !open)
      }
      if (key === 'l' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void lock()
      }
      if (key === '1' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        setView('dashboard')
        setSelectedProjectId(null)
        void setMode('local')
      }
      if (key === '2' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        setView('dashboard')
        setSelectedProjectId(null)
        void setMode('projects')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lock, setMode, setSelectedProjectId])

  useEffect(() => window.vault.onAutoLock(() => { void lock() }), [lock])

  return (
    <ApplicationShell
      background={shellBackground}
      sidebar={<Sidebar view={view} onViewChange={setView} />}
    >
        {showUi2026Vault ? (
          <div className="application-shell-content liquid-content relative min-w-0 flex-1 overflow-hidden bg-bg">
            <MainContentDragStrip />
            <VaultSurface
              embedded
              onSurfaceChange={() => undefined}
            />
          </div>
        ) : mode === 'projects' ? (
          <div className="application-shell-content liquid-content relative flex-1 overflow-hidden bg-bg">
            <MainContentDragStrip />
            <ProjectsView />
          </div>
        ) : view === 'dashboard' ? (
          <div className="application-shell-content liquid-content relative flex-1 overflow-hidden bg-bg">
            <MainContentDragStrip />
            <LocalDashboard onOpenSecret={() => setView('folders')} />
          </div>
        ) : (
          <div className="application-shell-content liquid-content relative min-w-0 flex-1 overflow-hidden bg-bg">
            <MainContentDragStrip />
            <SecretDetail emptyState="folder" />
          </div>
        )}

        {showSearch && (
          <GlobalSearch
            onClose={() => setShowSearch(false)}
            onPick={() => setView('folders')}
          />
        )}
        <CommunityOnboardingResearchPrompt />
    </ApplicationShell>
  )
}
