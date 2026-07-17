import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import {
  ArrowLeft,
  Bell,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Play,
  Plus,
  Puzzle,
  Search,
  Settings,
  Square,
  X,
} from 'lucide-react'
import type {
  MenuPanelAction,
  MenuPanelSearchResult,
  MenuPanelStatusResult,
} from '../../../shared/menuPanelIpcContracts'

type MenuPanelTabId = 'recent' | 'keys' | 'other' | 'all'
type MenuPanelScreen = 'home' | 'search' | 'add'
type QuickAddMode = 'text' | 'image'
type MenuPanelFieldAction = 'copy' | 'view'

type ProtectedFieldRequest = {
  action: MenuPanelFieldAction
  secretId: string
  fieldId?: string
  fieldKey: string
  label: string
}

type PanelStatus = {
  appName: string
  unlocked: boolean
  pendingCount: number
  agentListening: boolean
  agentAvailable: boolean
  agentPort: number
  browserEnabled: boolean
  browserAvailable: boolean
  quickRevealPinEnabled: boolean
  openCoreBuild: boolean
}

type PanelActionKey = MenuPanelAction | 'openApp'

const BROWSE_TABS: Array<{ id: MenuPanelTabId; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'keys', label: 'Keys/Tokens' },
  { id: 'other', label: 'Other' },
  { id: 'all', label: 'All' },
]

function isCredentialLike(result: MenuPanelSearchResult): boolean {
  const searchText = [
    result.name,
    result.type,
    result.scope,
    ...result.tags,
    ...result.fields.map(field => field.key),
  ].filter(Boolean).join(' ').toLowerCase()
  return /\b(api|key|token|secret|credential|password|pat|oauth|cloudflare|deploy|worker)\b/.test(searchText)
}

function isRecent(result: MenuPanelSearchResult): boolean {
  return Boolean(result.lastUsedAt || (result.usageCount ?? 0) > 0)
}

function resultMatchesTab(result: MenuPanelSearchResult, tab: MenuPanelTabId): boolean {
  if (tab === 'all') return true
  if (tab === 'recent') return isRecent(result)
  if (tab === 'keys') return isCredentialLike(result)
  return !isCredentialLike(result)
}

function tabCounts(results: MenuPanelSearchResult[]): Record<MenuPanelTabId, number> {
  return {
    recent: results.filter(result => resultMatchesTab(result, 'recent')).length,
    keys: results.filter(result => resultMatchesTab(result, 'keys')).length,
    other: results.filter(result => resultMatchesTab(result, 'other')).length,
    all: results.length,
  }
}

function fallbackTab(counts: Record<MenuPanelTabId, number>): MenuPanelTabId {
  if (counts.recent > 0) return 'recent'
  if (counts.keys > 0) return 'keys'
  if (counts.other > 0) return 'other'
  return 'all'
}

function fieldValueKey(secretId: string, fieldKey: string, fieldId?: string): string {
  return `${secretId}:${fieldId ?? fieldKey}`
}

function fieldActionKey(action: MenuPanelFieldAction, secretId: string, fieldKey: string, fieldId?: string): string {
  return `${action}:${secretId}:${fieldId ?? fieldKey}`
}

function panelStatusFromResponse(response: MenuPanelStatusResult): PanelStatus {
  return {
    appName: response.appName ?? 'Vaultage',
    unlocked: response.unlocked === true,
    pendingCount: response.pendingCount ?? 0,
    agentListening: response.agentListening === true,
    agentAvailable: response.agentAvailable === true,
    agentPort: response.agentPort ?? 43777,
    browserEnabled: response.browserEnabled === true,
    browserAvailable: response.browserAvailable === true,
    quickRevealPinEnabled: response.quickRevealPinEnabled === true,
    openCoreBuild: response.openCoreBuild === true,
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

export default function MenuBarPanel() {
  const [status, setStatus] = useState<PanelStatus | null>(null)
  const [screen, setScreen] = useState<MenuPanelScreen>('home')
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>('text')
  const [quickAddName, setQuickAddName] = useState('')
  const [quickAddText, setQuickAddText] = useState('')
  const [quickAddImage, setQuickAddImage] = useState('')
  const [quickAddSaved, setQuickAddSaved] = useState('')
  const [quickAddBusy, setQuickAddBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MenuPanelSearchResult[]>([])
  const [activeTab, setActiveTab] = useState<MenuPanelTabId>('recent')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [pendingAction, setPendingAction] = useState('')
  const [authRequest, setAuthRequest] = useState<ProtectedFieldRequest | null>(null)
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [panelActionBusy, setPanelActionBusy] = useState<PanelActionKey | ''>('')
  const inputRef = useRef<HTMLInputElement>(null)

  const refreshStatus = async () => {
    const response = await window.vault.menuPanelStatus()
    const next = panelStatusFromResponse(response)
    setStatus(next)
    if (!next.unlocked) {
      setResults([])
      setBusy(false)
    }
    return next
  }

  useEffect(() => {
    let cancelled = false
    window.vault.menuPanelStatus().then(response => {
      if (cancelled) return
      setStatus(panelStatusFromResponse(response))
      if (response.unlocked !== true) setBusy(false)
    }).catch(err => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!status?.unlocked || screen !== 'search') return
    const timer = setTimeout(() => {
      setBusy(true)
      window.vault.menuPanelSearch({ query, limit: 24 }).then(response => {
        setResults(response.results ?? [])
        setError(response.success ? '' : response.error ?? 'Search failed')
      }).catch(err => {
        setError(err instanceof Error ? err.message : String(err))
      }).finally(() => setBusy(false))
    }, 80)
    return () => clearTimeout(timer)
  }, [query, screen, status?.unlocked])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (screen === 'home') {
          void window.vault.menuPanelClose()
        } else {
          setScreen('home')
          setAuthRequest(null)
          setAuthError('')
          setPin('')
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [screen])

  useEffect(() => {
    if (screen !== 'search') return
    inputRef.current?.focus()
  }, [screen])

  const subtitle = useMemo(() => {
    if (!status) return 'Loading...'
    if (!status.unlocked) return `${status.appName} is locked`
    const agentVisible = status.agentAvailable || status.agentListening
    const browserVisible = status.browserAvailable || status.browserEnabled
    if (status.openCoreBuild || (!agentVisible && !browserVisible)) return 'Vault unlocked'
    if (agentVisible && status.pendingCount > 0) {
      return `${status.pendingCount} approval${status.pendingCount === 1 ? '' : 's'} pending`
    }
    return [
      agentVisible ? (status.agentListening ? 'Agent on' : 'Agent off') : '',
      browserVisible ? (status.browserEnabled ? 'Browser on' : 'Browser off') : '',
    ].filter(Boolean).join(' / ')
  }, [status])

  const counts = useMemo(() => tabCounts(results), [results])
  const effectiveTab = counts[activeTab] > 0 || activeTab === 'all'
    ? activeTab
    : fallbackTab(counts)
  const visibleTabs = useMemo(() => BROWSE_TABS.filter(tab => tab.id === 'all' || counts[tab.id] > 0), [counts])
  const visibleResults = useMemo(
    () => results.filter(result => resultMatchesTab(result, effectiveTab)),
    [effectiveTab, results],
  )

  const clearRevealedField = (secretId: string, fieldKey: string, fieldId?: string) => {
    const key = fieldValueKey(secretId, fieldKey, fieldId)
    setRevealed(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const runFieldAction = async (request: ProtectedFieldRequest, pinCode?: string) => {
    const actionKey = fieldActionKey(request.action, request.secretId, request.fieldKey, request.fieldId)
    const valueKey = fieldValueKey(request.secretId, request.fieldKey, request.fieldId)
    setPendingAction(actionKey)
    setCopied('')
    setAuthError('')
    try {
      const payload = {
        secretId: request.secretId,
        fieldId: request.fieldId,
        fieldKey: request.fieldKey,
        ...(pinCode ? { pin: pinCode } : {}),
      }
      if (request.action === 'copy') {
        const response = await window.vault.menuPanelCopy({ ...payload, clearAfterMs: 45_000 })
        if (!response.success) {
          const message = response.error ?? 'Could not copy field'
          if (status?.quickRevealPinEnabled) setAuthError(message)
          else setError(message)
          return
        }
        setCopied(valueKey)
        setTimeout(() => setCopied(current => current === valueKey ? '' : current), 1600)
      } else {
        const response = await window.vault.menuPanelReveal(payload)
        if (!response.success) {
          const message = response.error ?? 'Could not view field'
          if (status?.quickRevealPinEnabled) setAuthError(message)
          else setError(message)
          return
        }
        setRevealed(current => ({ ...current, [valueKey]: response.value ?? '' }))
        setTimeout(() => {
          setRevealed(current => {
            if (!(valueKey in current)) return current
            const next = { ...current }
            delete next[valueKey]
            return next
          })
        }, 15_000)
      }
      setAuthRequest(null)
      setPin('')
      setError('')
    } finally {
      setPendingAction(current => current === actionKey ? '' : current)
    }
  }

  const requestFieldAction = (request: ProtectedFieldRequest) => {
    if (request.action === 'view' && fieldValueKey(request.secretId, request.fieldKey, request.fieldId) in revealed) {
      clearRevealedField(request.secretId, request.fieldKey, request.fieldId)
      return
    }
    if (status?.quickRevealPinEnabled) {
      setAuthRequest(request)
      setPin('')
      setAuthError('')
      setError('')
      return
    }
    void runFieldAction(request)
  }

  const runPanelAction = async (action: PanelActionKey) => {
    setPanelActionBusy(action)
    setError('')
    try {
      const response = action === 'openApp'
        ? await window.vault.menuPanelOpenApp()
        : await window.vault.menuPanelAction({ action })
      if (!response.success) {
        setError(response.error ?? 'Action failed')
        return
      }
      if (action !== 'quit') await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPanelActionBusy(current => current === action ? '' : current)
    }
  }

  const openQuickAdd = (mode: QuickAddMode) => {
    setQuickAddMode(mode)
    setQuickAddSaved('')
    setError('')
    setScreen('add')
  }

  const handleImagePaste = async (event: ClipboardEvent<HTMLElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))
    if (!imageItem) return
    const file = imageItem.getAsFile()
    if (!file) return
    event.preventDefault()
    try {
      setQuickAddImage(await fileToDataUrl(file))
      setQuickAddSaved('')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveQuickAdd = async () => {
    if (!unlocked || quickAddBusy) return
    const name = quickAddName.trim()
    const text = quickAddText.trim()
    setQuickAddBusy(true)
    setQuickAddSaved('')
    setError('')
    try {
      const response = quickAddMode === 'text'
        ? await window.vault.menuPanelCreate({ kind: 'text', name: name || undefined, value: text })
        : await window.vault.menuPanelCreate({ kind: 'image', name: name || undefined, dataUrl: quickAddImage })
      if (!response.success) throw new Error(response.error ?? 'Could not save secret')
      setQuickAddSaved('Saved')
      setQuery(name || (quickAddMode === 'text' ? 'Pasted secret' : 'Pasted image'))
      setQuickAddName('')
      setQuickAddText('')
      setQuickAddImage('')
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setQuickAddBusy(false)
    }
  }

  const appName = status?.appName ?? 'Vaultage'
  const unlocked = status?.unlocked === true
  const privateBuild = status?.openCoreBuild === false
  const agentControlsVisible = status?.agentAvailable === true || status?.agentListening === true
  const browserControlsVisible = status?.browserAvailable === true || status?.browserEnabled === true
  const controlColumns = 1 + Number(agentControlsVisible) + Number(browserControlsVisible)
  const agentAction: MenuPanelAction = status?.agentListening ? 'stopAgent' : 'startAgent'
  const browserAction: MenuPanelAction = status?.browserEnabled ? 'stopBrowser' : 'startBrowser'
  const screenTitle = screen === 'home'
    ? appName
    : screen === 'search'
      ? 'Search secrets'
      : 'Add secret'
  const screenSubtitle = screen === 'home'
    ? subtitle
    : screen === 'search'
      ? 'Copy or view fields'
      : quickAddMode === 'text'
        ? 'Paste text'
        : 'Paste image'
  const actionButtonClass = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold text-text-secondary transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-35'
  const goHome = () => {
    setScreen('home')
    setAuthRequest(null)
    setAuthError('')
    setPin('')
    setQuickAddSaved('')
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#111314]/95 text-text shadow-2xl backdrop-blur">
      <div className="flex items-start gap-2 border-b border-white/[0.08] px-3 py-3">
        {screen !== 'home' && (
          <button
            type="button"
            onClick={goHome}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition hover:text-text"
            title="Back"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{screenTitle}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted">{screenSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void window.vault.menuPanelClose()}
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition hover:text-text"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {screen === 'home' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
          {agentControlsVisible && status?.pendingCount ? (
            <button
              type="button"
              onClick={() => void runPanelAction('openPendingRequests')}
              disabled={Boolean(panelActionBusy)}
              className="flex w-full items-center gap-2 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-left transition hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Bell className="h-4 w-4 flex-shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{status.pendingCount} approval{status.pendingCount === 1 ? '' : 's'} pending</p>
                <p className="truncate text-[10px] text-muted">Open requests</p>
              </div>
            </button>
          ) : null}

          {error && (
            <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setError('')
              setScreen('search')
            }}
            disabled={!unlocked}
            className="flex w-full items-center gap-3 rounded-xl border border-accent/25 bg-accent/10 px-3 py-3 text-left transition hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Search className="h-5 w-5 flex-shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Search secrets</p>
              <p className="truncate text-[10px] text-muted">{unlocked ? 'Copy or view one field at a time' : 'Unlock first'}</p>
            </div>
          </button>

          <section>
            <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Add</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openQuickAdd('text')}
                disabled={!unlocked}
                className="flex h-16 min-w-0 flex-col justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-left transition hover:bg-white/[0.06] hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileText className="mb-1 h-4 w-4 text-muted" />
                <span className="truncate text-xs font-semibold">Paste text</span>
                <span className="truncate text-[10px] text-muted">Secure note</span>
              </button>
              <button
                type="button"
                onClick={() => openQuickAdd('image')}
                disabled={!unlocked}
                className="flex h-16 min-w-0 flex-col justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-left transition hover:bg-white/[0.06] hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ImageIcon className="mb-1 h-4 w-4 text-muted" />
                <span className="truncate text-xs font-semibold">Paste image</span>
                <span className="truncate text-[10px] text-muted">Screenshot</span>
              </button>
            </div>
          </section>

          <section>
            <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Controls</p>
            <div
              className={[
                'grid gap-1.5',
                controlColumns === 3 ? 'grid-cols-3' : controlColumns === 2 ? 'grid-cols-2' : 'grid-cols-1',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => unlocked ? void runPanelAction('lock') : void runPanelAction('openApp')}
                disabled={Boolean(panelActionBusy)}
                className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2 py-2 text-left transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Lock className="mb-1 h-3.5 w-3.5 text-muted" />
                <p className="truncate text-[11px] font-semibold">Vault</p>
                <p className={['truncate text-[10px]', unlocked ? 'text-accent' : 'text-muted'].join(' ')}>
                  {unlocked ? 'Unlocked' : 'Locked'}
                </p>
              </button>
              {agentControlsVisible && (
                <button
                  type="button"
                  onClick={() => void runPanelAction(agentAction)}
                  disabled={!unlocked || Boolean(panelActionBusy)}
                  className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2 py-2 text-left transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {panelActionBusy === agentAction ? (
                    <Loader2 className="mb-1 h-3.5 w-3.5 animate-spin text-accent" />
                  ) : status?.agentListening ? (
                    <Square className="mb-1 h-3.5 w-3.5 text-accent" />
                  ) : (
                    <Play className="mb-1 h-3.5 w-3.5 text-muted" />
                  )}
                  <p className="truncate text-[11px] font-semibold">Agent</p>
                  <p className={['truncate text-[10px]', status?.agentListening ? 'text-accent' : 'text-muted'].join(' ')}>
                    {status?.agentListening ? 'On' : 'Off'}
                  </p>
                </button>
              )}
              {browserControlsVisible && (
                <button
                  type="button"
                  onClick={() => void runPanelAction(browserAction)}
                  disabled={!unlocked || Boolean(panelActionBusy)}
                  className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2 py-2 text-left transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {panelActionBusy === browserAction ? (
                    <Loader2 className="mb-1 h-3.5 w-3.5 animate-spin text-accent" />
                  ) : (
                    <Puzzle className={['mb-1 h-3.5 w-3.5', status?.browserEnabled ? 'text-accent' : 'text-muted'].join(' ')} />
                  )}
                  <p className="truncate text-[11px] font-semibold">Browser</p>
                  <p className={['truncate text-[10px]', status?.browserEnabled ? 'text-accent' : 'text-muted'].join(' ')}>
                    {status?.browserEnabled ? 'On' : 'Off'}
                  </p>
                </button>
              )}
            </div>
          </section>

          <div className={`mt-auto grid ${privateBuild ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 pt-1`}>
            <button
              type="button"
              onClick={() => void runPanelAction('openApp')}
              disabled={Boolean(panelActionBusy)}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] px-2 text-[11px] font-semibold transition hover:bg-white/[0.09] hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {panelActionBusy === 'openApp' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Open
            </button>
            {privateBuild && (
              <button
                type="button"
                onClick={() => void runPanelAction('settings')}
                disabled={Boolean(panelActionBusy)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] px-2 text-[11px] font-semibold text-text-secondary transition hover:bg-white/[0.09] hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
            )}
            <button
              type="button"
              onClick={() => void runPanelAction('quit')}
              disabled={Boolean(panelActionBusy)}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] px-2 text-[11px] font-semibold text-text-secondary transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-45"
            >
              <LogOut className="h-3.5 w-3.5" />
              Quit
            </button>
          </div>
        </div>
      )}

      {screen === 'add' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3" onPaste={quickAddMode === 'image' ? handleImagePaste : undefined}>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={() => {
                setQuickAddMode('text')
                setQuickAddSaved('')
                setError('')
              }}
              className={[
                'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition',
                quickAddMode === 'text' ? 'bg-white/[0.1] text-text' : 'text-muted hover:text-text',
              ].join(' ')}
            >
              <FileText className="h-3.5 w-3.5" />
              Text
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickAddMode('image')
                setQuickAddSaved('')
                setError('')
              }}
              className={[
                'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition',
                quickAddMode === 'image' ? 'bg-white/[0.1] text-text' : 'text-muted hover:text-text',
              ].join(' ')}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Image
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          {quickAddSaved && (
            <p className="rounded-lg border border-accent/20 bg-accent/10 px-3 py-2 text-xs text-accent">
              {quickAddSaved}
            </p>
          )}

          <input
            value={quickAddName}
            onChange={event => setQuickAddName(event.target.value)}
            placeholder={quickAddMode === 'text' ? 'Name, e.g. Recovery code' : 'Name, e.g. Console screenshot'}
            className="h-9 rounded-lg border border-white/[0.1] bg-black/20 px-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent/35"
          />

          {quickAddMode === 'text' ? (
            <textarea
              value={quickAddText}
              onChange={event => {
                setQuickAddText(event.target.value)
                setQuickAddSaved('')
              }}
              placeholder="Paste secret text"
              data-secure-input="true"
              className="min-h-40 flex-1 resize-none rounded-xl border border-white/[0.1] bg-black/20 px-3 py-3 text-sm leading-relaxed text-text outline-none placeholder:text-muted focus:border-accent/35"
            />
          ) : (
            <div
              tabIndex={0}
              className="flex min-h-40 flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/[0.16] bg-black/20 p-3 text-center outline-none focus:border-accent/40"
            >
              {quickAddImage ? (
                <img src={quickAddImage} alt="Pasted secret" className="max-h-56 w-full object-contain" />
              ) : (
                <>
                  <ImageIcon className="h-7 w-7 text-muted" />
                  <p className="mt-3 text-xs font-semibold">Paste an image</p>
                  <p className="mt-1 text-[10px] text-muted">Use Cmd+V here</p>
                </>
              )}
            </div>
          )}

          <div className="mt-auto grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={() => void saveQuickAdd()}
              disabled={
                !unlocked ||
                quickAddBusy ||
                (quickAddMode === 'text' ? !quickAddText.trim() : !quickAddImage)
              }
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-black transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {quickAddBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickAddName('')
                setQuickAddText('')
                setQuickAddImage('')
                setQuickAddSaved('')
                setError('')
              }}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-white/[0.06] px-3 text-xs font-semibold text-text-secondary transition hover:bg-white/[0.09] hover:text-text"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {screen === 'search' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {!unlocked ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
              <Lock className="h-5 w-5 text-muted" />
              <p className="mt-4 text-sm font-semibold">Unlock {appName}</p>
              <button
                type="button"
                onClick={() => void runPanelAction('openApp')}
                className="mt-4 inline-flex h-8 items-center justify-center rounded-lg bg-white/[0.07] px-3 text-xs font-semibold transition hover:bg-white/[0.1] hover:text-accent"
              >
                Open Vaultage
              </button>
            </div>
          ) : (
            <>
              <div className="border-b border-white/[0.08] px-3 py-2.5">
                <div className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-black/20 px-3">
                  <Search className="h-4 w-4 text-muted" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search secrets"
                    className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
                  />
                </div>
                {results.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 overflow-x-auto">
                    {visibleTabs.map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                          'flex h-7 flex-shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-semibold transition-colors',
                          effectiveTab === tab.id ? 'bg-white/[0.07] text-text' : 'text-muted hover:text-text',
                        ].join(' ')}
                      >
                        {tab.label}
                        <span className="text-[9px] text-muted">{counts[tab.id]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {authRequest && (
                <div className="mx-3 mt-3 rounded-xl border border-white/[0.12] bg-black/35 p-3 shadow-xl shadow-black/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-text">
                        {authRequest.action === 'copy' ? 'Copy' : 'View'} {authRequest.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted">Touch ID or reveal PIN</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthRequest(null)
                        setPin('')
                        setAuthError('')
                      }}
                      className="text-muted transition hover:text-text"
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void runFieldAction(authRequest)}
                      disabled={Boolean(pendingAction)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent/10 px-2.5 text-[10px] font-semibold text-accent transition hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {pendingAction === fieldActionKey(authRequest.action, authRequest.secretId, authRequest.fieldKey, authRequest.fieldId)
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <KeyRound className="h-3 w-3" />}
                      Touch ID
                    </button>
                    <input
                      value={pin}
                      onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && /^\d{4}(?:\d{2})?$/.test(pin) && authRequest) {
                          void runFieldAction(authRequest, pin)
                        }
                      }}
                      inputMode="numeric"
                      maxLength={6}
                      type="password"
                      data-secure-input="true"
                      placeholder="PIN"
                      disabled={Boolean(pendingAction)}
                      className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.1] bg-black/25 px-2 text-center text-xs text-text outline-none placeholder:text-muted focus:border-accent/45 disabled:opacity-45"
                    />
                    <button
                      type="button"
                      onClick={() => void runFieldAction(authRequest, pin)}
                      disabled={!/^\d{4}(?:\d{2})?$/.test(pin) || Boolean(pendingAction)}
                      className="inline-flex h-7 items-center rounded-md px-2.5 text-[10px] font-semibold text-text-secondary transition hover:text-text disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      PIN
                    </button>
                  </div>
                  {authError && <p className="mt-2 text-[10px] text-danger">{authError}</p>}
                </div>
              )}

              {error && (
                <p className="mx-3 mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {busy && results.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted">Searching...</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted">
                    {query.trim() ? 'No matching secrets.' : 'No secrets to show yet.'}
                  </p>
                ) : visibleResults.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted">No secrets in this tab.</p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {visibleResults.map(result => (
                      <div key={result.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 px-3 py-2.5">
                        <KeyRound className="mt-0.5 h-3.5 w-3.5 text-accent" />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <p className="min-w-0 truncate text-xs font-semibold text-text">{result.name}</p>
                            <span className="flex-shrink-0 text-[9px] uppercase tracking-wide text-muted">{result.type}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-muted">{result.folderPath}</p>
                          <div className="mt-1.5 space-y-1">
                            {result.fields.slice(0, 3).map(field => {
                              const valueKey = fieldValueKey(result.id, field.key, field.id)
                              const copyActionKey = fieldActionKey('copy', result.id, field.key, field.id)
                              const viewActionKey = fieldActionKey('view', result.id, field.key, field.id)
                              const isRevealed = valueKey in revealed
                              return (
                                <div key={field.id ?? field.key} className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">{field.key}</span>
                                    <div className="flex flex-shrink-0 items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={!field.copyable || Boolean(pendingAction)}
                                        onClick={() => requestFieldAction({
                                          action: 'copy',
                                          secretId: result.id,
                                          fieldId: field.id,
                                          fieldKey: field.key,
                                          label: field.key,
                                        })}
                                        className={actionButtonClass}
                                        title={`Copy ${field.key}`}
                                      >
                                        {pendingAction === copyActionKey ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : copied === valueKey ? (
                                          <Check className="h-3 w-3" />
                                        ) : (
                                          <Copy className="h-3 w-3" />
                                        )}
                                        {copied === valueKey ? 'Copied' : 'Copy'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!field.copyable || Boolean(pendingAction)}
                                        onClick={() => requestFieldAction({
                                          action: 'view',
                                          secretId: result.id,
                                          fieldId: field.id,
                                          fieldKey: field.key,
                                          label: field.key,
                                        })}
                                        className={actionButtonClass}
                                        title={`${isRevealed ? 'Hide' : 'View'} ${field.key}`}
                                      >
                                        {pendingAction === viewActionKey ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : isRevealed ? (
                                          <EyeOff className="h-3 w-3" />
                                        ) : (
                                          <Eye className="h-3 w-3" />
                                        )}
                                        {isRevealed ? 'Hide' : 'View'}
                                      </button>
                                    </div>
                                  </div>
                                  {isRevealed && (
                                    <p className="mt-1 break-all rounded-md bg-black/30 px-2 py-1 font-mono text-[10px] leading-relaxed text-text">
                                      {revealed[valueKey]}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                            {result.fields.length > 3 && (
                              <span className="text-[10px] text-muted">+{result.fields.length - 3}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
