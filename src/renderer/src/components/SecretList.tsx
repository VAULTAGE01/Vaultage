import { useState, useMemo } from 'react'
import { useVault, findFolder } from '../vaultContext'
import type { SecretType, VaultSecret } from '../types'
import AddSecretModal from '#add-secret-modal'
import ExportModal from './ExportModal'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { EnvChip, envBorderStyle } from '@/components/ui/env-chip'
import { sortScopes } from '@/lib/env'
import { ActionTooltip } from './ActionTooltip'

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(' ')
}

// ── Icons ──────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<SecretType, React.ReactNode> = {
  password: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25z" />
    </svg>
  ),
  apiKey: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  ),
  sshKey: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  ),
  secureNote: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z" />
    </svg>
  ),
  custom: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
    </svg>
  ),
  image: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  ),
}

const TYPE_COLOR: Record<SecretType, string> = {
  password:   'text-blue-400   bg-blue-500/10',
  apiKey:     'text-purple-400 bg-purple-500/10',
  sshKey:     'text-accent     bg-accent/10',
  secureNote: 'text-amber-400  bg-amber-500/10',
  custom:     'text-text-secondary bg-white/5',
  image:      'text-pink-400   bg-pink-500/10',
}

// ── Sort ───────────────────────────────────────────────────────────────────

type SortKey = 'name-asc' | 'name-desc' | 'updated-desc' | 'updated-asc' | 'last-used' | 'expiry' | 'most-used'

const SORT_LABELS: Record<SortKey, string> = {
  'name-asc':    'Name A→Z',
  'name-desc':   'Name Z→A',
  'updated-desc':'Newest first',
  'updated-asc': 'Oldest first',
  'last-used':   'Last used',
  'expiry':      'Expiring soon',
  'most-used':   'Most project maps',
}

function sortSecrets(secrets: VaultSecret[], key: SortKey, projectUsageCount: Map<string, number>): VaultSecret[] {
  return [...secrets].sort((a, b) => {
    switch (key) {
      case 'name-asc':     return a.name.localeCompare(b.name)
      case 'name-desc':    return b.name.localeCompare(a.name)
      case 'updated-desc': return b.updatedAt.localeCompare(a.updatedAt)
      case 'updated-asc':  return a.updatedAt.localeCompare(b.updatedAt)
      case 'most-used':    return (projectUsageCount.get(b.id) ?? 0) - (projectUsageCount.get(a.id) ?? 0)
      case 'last-used': {
        if (!a.lastUsedAt && !b.lastUsedAt) return 0
        if (!a.lastUsedAt) return 1
        if (!b.lastUsedAt) return -1
        return b.lastUsedAt.localeCompare(a.lastUsedAt)
      }
      case 'expiry': {
        if (!a.expiresAt && !b.expiresAt) return 0
        if (!a.expiresAt) return 1
        if (!b.expiresAt) return -1
        return a.expiresAt.localeCompare(b.expiresAt)
      }
    }
  })
}

// ── Sort dropdown ──────────────────────────────────────────────────────────

function SortDropdown({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
	        <button
	          title={`Choose a secret sort order. Current: ${SORT_LABELS[value]}. Shortcut: Enter`}
          className={cn(
            'p-1.5 rounded-lg transition-colors flex-shrink-0',
            value !== 'name-asc'
              ? 'text-accent bg-accent/10'
              : 'text-muted hover:text-text hover:bg-white/5'
          )}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5h18M6 12h12M9 16.5h6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([k, label]) => (
          <DropdownMenuItem
            key={k}
            onClick={() => onChange(k)}
            className={cn(
              value === k ? 'text-accent bg-accent/10' : 'text-muted hover:text-text'
            )}
          >
            {value === k && <span className="mr-1.5">✓</span>}
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Expiry helper ──────────────────────────────────────────────────────────

function expiryStatus(expiresAt?: string): 'expired' | 'soon' | null {
  if (!expiresAt) return null
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
  if (days < 0)   return 'expired'
  if (days <= 30) return 'soon'
  return null
}

// ── Secret card ────────────────────────────────────────────────────────────

function SecretCard({ secret, selected, providerName, projectUsageCount, onClick }: {
  secret: VaultSecret; selected: boolean; providerName?: string; projectUsageCount: number; onClick: () => void
}) {
  const isImage    = secret.type === 'image'
  const firstField = !isImage ? secret.fields.find(f => !f.sensitive && f.value) : undefined
  const expiry     = expiryStatus(secret.expiresAt)
  const showProviderName = __VAULTAGE_OPEN_CORE__ ? undefined : providerName

  return (
	    <button
	      onClick={onClick}
	      title={`Open ${secret.name}. Shortcut: Enter`}
	      className={cn(
        'w-full text-left pl-2 pr-3 py-2.5 rounded-lg border transition-all',
        selected
          ? 'text-white bg-accent border-accent'
          : 'border-transparent hover:bg-white/5 text-text'
      )}
      style={selected ? undefined : envBorderStyle(secret.scope)}
    >
      <div className="flex items-center gap-2.5">
        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', TYPE_COLOR[secret.type])}>
          {TYPE_ICON[secret.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium truncate">{secret.name}</p>
            {expiry === 'expired' && <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" title="Expired" />}
            {expiry === 'soon'    && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" title="Expiring soon" />}
            {projectUsageCount > 1 && (
              <span className="px-1 py-px rounded text-[9px] bg-accent/10 text-accent/80 flex-shrink-0 font-medium" title={`Mapped to ${projectUsageCount} projects`}>
                {projectUsageCount}×
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {showProviderName && (
              <span
                title={`Linked to ${showProviderName}`}
                className="inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[9px] font-medium flex-shrink-0"
                style={{
                  background: 'rgba(56,189,248,0.08)',
                  border:     '1px solid rgba(56,189,248,0.22)',
                  color:      '#7dd3fc',
                }}
              >
                <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
                {showProviderName}
              </span>
            )}
            {firstField ? (
              <p className="text-[10px] text-muted truncate">{firstField.value}</p>
            ) : secret.tags && secret.tags.length > 0 ? (
              <p className="text-[10px] text-muted truncate">{secret.tags.join(', ')}</p>
            ) : isImage ? (
              <p className="text-[10px] text-muted">Hidden image</p>
            ) : null}
          </div>
        </div>
        {secret.scope && <EnvChip scope={secret.scope} className="flex-shrink-0" />}
      </div>
    </button>
  )
}

// ── SecretList ─────────────────────────────────────────────────────────────

export default function SecretList() {
  const { state, selectSecret } = useVault()
  const [showAdd,      setShowAdd]      = useState(false)
  const [query,        setQuery]        = useState('')
  const [sortKey,      setSortKey]      = useState<SortKey>('name-asc')
  const [activeTags,   setActiveTags]   = useState<Set<string>>(new Set())
  const [activeEnv,    setActiveEnv]    = useState<string | null>(null) // null = all
  const [showExport,   setShowExport]   = useState(false)

  if (!state.vault || !state.selectedFolderId) return null
  const folder = findFolder(state.vault.root, state.selectedFolderId)
  if (!folder) return null

  const providerNameById: Record<string, string> = Object.fromEntries(
    state.vault.providers.map(p => [p.id, p.name])
  )
  const projectUsageCount = useMemo(() => {
    const count = new Map<string, Set<string>>()
    for (const project of state.vault?.envProjects ?? []) {
      for (const entry of project.entries) {
        if (!count.has(entry.secretId)) count.set(entry.secretId, new Set())
        count.get(entry.secretId)!.add(project.id)
      }
    }
    return new Map([...count.entries()].map(([secretId, projects]) => [secretId, projects.size]))
  }, [state.vault?.envProjects])

  // Reset tag filter when folder changes
  // (handled implicitly — activeTags that don't exist in this folder simply won't match anything)

  // Collect all unique tags across this folder's secrets, sorted by frequency
  const allTags = useMemo(() => {
    const freq = new Map<string, number>()
    for (const s of folder.secrets) {
      for (const t of s.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1)
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [folder.secrets])

  // Env distribution across this folder
  const envCounts = useMemo(() => {
    const freq = new Map<string, number>()
    let unscoped = 0
    for (const s of folder.secrets) {
      if (s.scope) freq.set(s.scope, (freq.get(s.scope) ?? 0) + 1)
      else         unscoped++
    }
    return { sorted: sortScopes([...freq.keys()]).map(k => ({ key: k, count: freq.get(k)! })), unscoped }
  }, [folder.secrets])

  const toggleTag = (tag: string) =>
    setActiveTags(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })

  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    let list = folder.secrets

    // text search
    if (q) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.tags?.some(t => t.toLowerCase().includes(q)) ||
        s.description?.toLowerCase().includes(q) ||
        s.scope?.toLowerCase().includes(q) ||
        (s.type !== 'image' && s.fields.some(f => !f.sensitive && f.value.toLowerCase().includes(q)))
      )
    }

    // tag filter — secret must have ALL active tags
    if (activeTags.size > 0) {
      list = list.filter(s => [...activeTags].every(t => s.tags?.includes(t)))
    }

    // env filter
    if (activeEnv !== null) {
      list = list.filter(s => (s.scope ?? '__unscoped__') === activeEnv)
    }

    return sortSecrets(list, sortKey, projectUsageCount)
  }, [folder.secrets, q, activeTags, activeEnv, sortKey, projectUsageCount])

  const hasFilters = q.length > 0 || activeTags.size > 0 || activeEnv !== null

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div
        className="h-11 drag-region flex items-center px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-color, #2e2e30)' }}
      >
        <span className="no-drag text-xs font-semibold text-text-secondary truncate">{folder.name}</span>
	        <button
	          onClick={() => setShowExport(true)}
	          title={`Export ${folder.name}. Shortcut: Enter`}
          className="no-drag ml-auto p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </button>
      </div>

      {/* Search + Sort */}
      <div className="px-3 py-2 no-drag flex items-center gap-1.5">
        <div
          className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border-light)',
          }}
        >
          <svg className="w-3 h-3 flex-shrink-0" style={{ color: '#5a5a5a' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-xs text-text placeholder-muted outline-none min-w-0"
          />
          {query && (
	            <button onClick={() => setQuery('')} title="Clear search. Shortcut: Enter" className="text-muted hover:text-text-secondary transition-colors flex-shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <SortDropdown value={sortKey} onChange={setSortKey} />
      </div>

      {/* Env filter pills */}
      {(envCounts.sorted.length > 0 || envCounts.unscoped > 0) && (
        <div className="px-3 pb-2 no-drag flex gap-1.5 flex-wrap items-center">
	          <button
	            onClick={() => setActiveEnv(null)}
	            title="Show all environment scopes. Shortcut: Enter"
	            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border',
              activeEnv === null
                ? 'bg-white/10 border-white/20 text-text'
                : 'border-transparent text-text-secondary hover:text-text hover:bg-white/5',
            )}
          >
            All · {folder.secrets.length}
          </button>
          {envCounts.sorted.map(({ key, count }) => {
            const active = activeEnv === key
            return (
	              <button
	                key={key}
	                onClick={() => setActiveEnv(active ? null : key)}
	                title={`${active ? 'Clear' : 'Apply'} ${key} scope filter. Shortcut: Enter`}
	                className="transition-opacity"
                style={{ opacity: activeEnv === null || active ? 1 : 0.45 }}
              >
                <EnvChip
                  scope={key}
                  size="md"
                  variant={active ? 'solid' : 'soft'}
                  showDot
                  className={active ? '' : 'hover:brightness-125'}
                />
                <span className="ml-1 text-[10px] text-text-secondary">{count}</span>
              </button>
            )
          })}
          {envCounts.unscoped > 0 && (
	            <button
	              onClick={() => setActiveEnv(activeEnv === '__unscoped__' ? null : '__unscoped__')}
	              title={`${activeEnv === '__unscoped__' ? 'Clear' : 'Apply'} unscoped filter. Shortcut: Enter`}
	              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border',
                activeEnv === '__unscoped__'
                  ? 'bg-white/10 border-white/20 text-text'
                  : 'border-border text-text-secondary hover:text-text hover:bg-white/5',
              )}
            >
              Unscoped · {envCounts.unscoped}
            </button>
          )}
        </div>
      )}

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="px-3 pb-2 no-drag flex gap-1.5 flex-wrap">
          {allTags.map(tag => {
            const active = activeTags.has(tag)
            return (
	              <button
	                key={tag}
	                onClick={() => toggleTag(tag)}
	                title={`${active ? 'Remove' : 'Apply'} ${tag} tag filter. Shortcut: Enter`}
	                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] transition-colors border',
                  active
                    ? 'bg-accent/20 text-accent border-accent/40 font-medium'
                    : 'bg-surface border-border text-muted hover:text-text hover:border-border/60'
                )}
              >
                {active && <span className="mr-1">×</span>}
                {tag}
              </button>
            )
          })}
          {activeTags.size > 0 && (
	            <button
	              onClick={() => setActiveTags(new Set())}
	              title="Clear tag filters. Shortcut: Enter"
	              className="px-2 py-0.5 rounded-full text-[10px] text-muted hover:text-text transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1 no-drag">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-secondary text-xs gap-2">
            {folder.secrets.length === 0 ? (
              <span>No secrets yet</span>
            ) : hasFilters ? (
              <div className="text-center space-y-1">
                <p>No matches</p>
	                <button
	                  onClick={() => { setQuery(''); setActiveTags(new Set()); setActiveEnv(null) }}
	                  title="Clear all filters. Shortcut: Enter"
	                  className="text-accent hover:text-accent-hover transition-colors text-[10px]"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <span>No secrets</span>
            )}
          </div>
        ) : (
          filtered.map(s => (
            <SecretCard
              key={s.id}
              secret={s}
              selected={state.selectedSecretId === s.id}
              providerName={s.providerLink && providerNameById[s.providerLink.providerId]}
              projectUsageCount={projectUsageCount.get(s.id) ?? 0}
              onClick={() => selectSecret(s.id)}
            />
          ))
        )}
      </div>

      {/* Footer: result count + add button */}
      <div
        className="px-3 py-2.5 no-drag space-y-2"
        style={{ borderTop: '1px solid var(--border-color, #2e2e30)' }}
      >
        {hasFilters && (
          <p className="text-[10px] text-muted text-center">
            {filtered.length} of {folder.secrets.length} secrets
          </p>
        )}
	        <ActionTooltip label="Add Secret" description={`Create a new encrypted secret in ${folder.name}.`} shortcut="Enter" side="top">
	          <Button
	            onClick={() => setShowAdd(true)}
	            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-xs transition-all text-white bg-accent hover:bg-accent-hover"
	          >
	            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
	              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
	            </svg>
	            Add Secret
	          </Button>
	        </ActionTooltip>
      </div>

      {showAdd && (
        <AddSecretModal
          folderId={folder.id}
          defaultScope={activeEnv && activeEnv !== '__unscoped__' ? activeEnv : undefined}
          onClose={() => setShowAdd(false)}
        />
      )}
      {showExport && (
        <ExportModal
          initialScope={{ kind: 'folder', id: folder.id }}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
