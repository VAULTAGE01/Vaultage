import { cn } from '@/lib/utils'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Cloud, Folder, Laptop, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { useVault } from '../vaultContext'
import type { EnvEntry, EnvProject, Provider, VaultFolder, VaultSecret } from '../types'
import type { ProjectDiscoverResult, ProjectScanCandidate, ProjectScanEnvKey, ProjectScanResult } from '../../../shared/projectScan'
import { Button } from '@/components/ui/button'
import { EnvChip } from '@/components/ui/env-chip'
import { Switch } from '@/components/ui/switch'
import { PinTargetButton } from './PinSecretButton'
import { isPinnedTarget, togglePinnedTargetOrder } from '@/lib/pinning'
import { exportEnvWithReplaceConfirmation } from '@/lib/envExport'
import { projectDeletionConfirmation, replaceEnvFileConfirmation } from '@/lib/projectActionPreviews'
import {
  getProjectEnvironmentDisplays,
  getProjectEnvironments,
  projectLocalEnvironment,
  projectPrimaryLocalPath,
  withLocalProjectEnvironment,
  type ProjectEnvironmentStatus,
} from '@/lib/projectEnvironments'

const PLAINTEXT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT'
type CreateFlow = 'scan-parent' | 'choose-folder'
type SecretOption = { secret: VaultSecret; folderName: string }

interface SecretSuggestion {
  secretId: string
  fieldKey: string
  secretName: string
  folderName: string
  reason: string
  score: number
}

interface EnvReviewItem {
  key: ProjectScanEnvKey
  entry: EnvEntry
  index: number
  envLabel: string
  serviceLabel: string
  sourceLabel: string
  suggestion: SecretSuggestion | null
}

interface EnvReviewGroup {
  id: string
  envLabel: string
  serviceLabel: string
  items: EnvReviewItem[]
}

// ── Flatten all secrets from the vault tree ────────────────────────────────

function flatSecrets(
  node: VaultFolder,
  folderName = node.name,
): { secret: VaultSecret; folderName: string }[] {
  const here = node.secrets.map(s => ({ secret: s, folderName }))
  const nested = node.children.flatMap(c => flatSecrets(c, c.name))
  return [...here, ...nested]
}

function pathName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(-3).join('/') || path
}

function entriesFromScan(result: ProjectScanResult): EnvEntry[] {
  return result.envKeys.map(envKey => ({
    envKey: envKey.key,
    secretId: '',
    fieldKey: '',
  }))
}

function normalizeSearch(value: string | undefined | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function searchTokens(value: string | undefined | null): string[] {
  return normalizeSearch(value).split('_').filter(token => token.length > 1)
}

function envLabelForKey(envKey: ProjectScanEnvKey): string {
  return envKey.environment ?? envKey.values.find(value => value.environment)?.environment ?? 'default'
}

function serviceLabelForKey(envKey: ProjectScanEnvKey): string {
  return envKey.serviceLabel ?? envKey.serviceId ?? 'Unlabeled service'
}

function sourceLabelForKey(envKey: ProjectScanEnvKey): string {
  const value = envKey.values[0]
  if (value) return `${shortPath(value.sourceFile)}:${value.line}`
  const source = envKey.sources[0]
  if (source) return `${shortPath(source.path)}${source.line ? `:${source.line}` : ''}`
  return 'No source'
}

function bestFieldForEnv(secret: VaultSecret, envKey: ProjectScanEnvKey): { fieldKey: string; score: number } | null {
  const keyNorm = normalizeSearch(envKey.key)
  const keyTokens = new Set(searchTokens(envKey.key))
  let best: { fieldKey: string; score: number } | null = null

  for (const field of secret.fields.filter(field => field.value)) {
    const fieldNorm = normalizeSearch(field.key)
    const fieldTokens = searchTokens(field.key)
    if (!fieldNorm || fieldTokens.length === 0) continue

    let score = 0
    if (fieldNorm === keyNorm) score += 10
    else if (keyNorm.endsWith(`_${fieldNorm}`) || keyNorm.startsWith(`${fieldNorm}_`)) score += 5
    for (const token of fieldTokens) if (keyTokens.has(token)) score += 1
    if (field.sensitive && /(key|token|secret|password|private|issuer|id|path)/.test(keyNorm)) score += 1

    if (!best || score > best.score) best = { fieldKey: field.key, score }
  }

  return best && best.score > 0 ? best : null
}

function findSecretSuggestion(envKey: ProjectScanEnvKey, allSecrets: SecretOption[]): SecretSuggestion | null {
  const envNorm = normalizeSearch(envLabelForKey(envKey))
  const serviceText = `${envKey.serviceLabel ?? ''} ${envKey.serviceId ?? ''}`
  const serviceNorm = normalizeSearch(serviceText)
  const serviceTokens = searchTokens(serviceText)
  const envTokens = searchTokens(envKey.key)
  let best: SecretSuggestion | null = null

  for (const { secret, folderName } of allSecrets) {
    const field = bestFieldForEnv(secret, envKey)
    if (!field) continue

    const secretText = normalizeSearch([
      secret.name,
      secret.description,
      secret.scope,
      ...(secret.tags ?? []),
      folderName,
    ].filter(Boolean).join(' '))
    let score = field.score

    if (serviceNorm && secretText.includes(serviceNorm)) score += 5
    for (const token of serviceTokens) if (token.length > 2 && secretText.includes(token)) score += 1
    for (const token of envTokens) if (token.length > 2 && secretText.includes(token)) score += 1
    if (envNorm && normalizeSearch(secret.scope) === envNorm) score += 2
    if ((secret.tags ?? []).some(tag => normalizeSearch(tag) === envNorm || normalizeSearch(tag) === serviceNorm)) score += 2

    if (score < 5) continue
    const suggestion = {
      secretId: secret.id,
      fieldKey: field.fieldKey,
      secretName: secret.name,
      folderName,
      reason: field.score >= 8 ? 'Exact field match' : serviceNorm ? 'Service and field match' : 'Field pattern match',
      score,
    }
    if (!best || suggestion.score > best.score) best = suggestion
  }

  return best
}

function manualReviewKey(entry: EnvEntry): ProjectScanEnvKey {
  return {
    key: entry.envKey,
    sources: [],
    values: [],
  }
}

function buildEnvReviewGroups(
  scanSummary: ProjectScanResult | null,
  localEntries: EnvEntry[],
  allSecrets: SecretOption[],
): EnvReviewGroup[] {
  const indexByEnvKey = new Map<string, number>()
  localEntries.forEach((entry, index) => {
    if (entry.envKey && !indexByEnvKey.has(entry.envKey)) indexByEnvKey.set(entry.envKey, index)
  })

  const seenEnvKeys = new Set<string>()
  const keys = scanSummary?.envKeys ?? localEntries.map(manualReviewKey)
  const groups = new Map<string, EnvReviewGroup>()
  const addItem = (envKey: ProjectScanEnvKey, index: number) => {
    const entry = index >= 0 ? localEntries[index] : { envKey: envKey.key, secretId: '', fieldKey: '' }
    const envLabel = envLabelForKey(envKey)
    const serviceLabel = serviceLabelForKey(envKey)
    const groupId = `${envLabel}::${serviceLabel}`
    const group = groups.get(groupId) ?? { id: groupId, envLabel, serviceLabel, items: [] }
    group.items.push({
      key: envKey,
      entry,
      index,
      envLabel,
      serviceLabel,
      sourceLabel: sourceLabelForKey(envKey),
      suggestion: findSecretSuggestion(envKey, allSecrets),
    })
    groups.set(groupId, group)
    seenEnvKeys.add(envKey.key)
  }

  for (const envKey of keys) addItem(envKey, indexByEnvKey.get(envKey.key) ?? -1)
  for (let index = 0; index < localEntries.length; index += 1) {
    const entry = localEntries[index]
    if (entry.envKey && !seenEnvKeys.has(entry.envKey)) addItem(manualReviewKey(entry), index)
  }

  return [...groups.values()]
}

// ── Entry row ─────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry:     EnvEntry
  allSecrets: { secret: VaultSecret; folderName: string }[]
  onChange:  (e: EnvEntry) => void
  onDelete:  () => void
}

function EntryRow({ entry, allSecrets, onChange, onDelete }: EntryRowProps) {
  const selectedSecret = allSecrets.find(x => x.secret.id === entry.secretId)?.secret
  const fieldOptions   = selectedSecret?.fields.filter(f => f.value) ?? []

  return (
    <div className="flex items-center gap-2 group">
      <input
        type="text"
        value={entry.envKey}
        onChange={e => onChange({ ...entry, envKey: e.target.value })}
        placeholder="ENV_KEY"
        className="w-40 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text placeholder-muted outline-none focus:border-accent font-mono transition-colors flex-shrink-0"
      />
      <span className="text-muted text-xs flex-shrink-0">→</span>
      <select
        value={entry.secretId}
        onChange={e => onChange({ ...entry, secretId: e.target.value, fieldId: undefined, fieldKey: '' })}
        className="flex-1 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent transition-colors"
      >
        <option value="">— select secret —</option>
        {allSecrets.map(({ secret, folderName }) => (
          <option key={secret.id} value={secret.id}>
            {folderName} / {secret.name}
          </option>
        ))}
      </select>
      <select
        value={entry.fieldId ?? entry.fieldKey}
        onChange={e => {
          const field = fieldOptions.find(option => option.id === e.target.value)
            ?? fieldOptions.find(option => option.key === e.target.value)
          onChange({ ...entry, fieldId: field?.id, fieldKey: field?.key ?? '' })
        }}
        disabled={!entry.secretId}
        className="w-32 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent disabled:opacity-40 transition-colors flex-shrink-0"
      >
        <option value="">— field —</option>
        {fieldOptions.map((f, fieldIndex) => (
          <option key={f.id ?? `${f.key}-${fieldIndex}`} value={f.id ?? f.key}>{f.key}</option>
        ))}
      </select>
      <button onClick={onDelete}
        className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function CreateFlowOption({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-accent/45 bg-accent/10 text-text' : 'border-border bg-black/10 text-text-secondary hover:bg-white/5 hover:text-text',
      )}
    >
      <span className="block text-xs font-semibold">{title}</span>
      <span className="mt-1 block text-[11px] leading-relaxed text-muted">{detail}</span>
    </button>
  )
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ProjectScanCandidate
  selected: boolean
  onSelect: () => void
}) {
  const detail = [
    `${candidate.envKeyCount} env key${candidate.envKeyCount === 1 ? '' : 's'}`,
    `${candidate.serviceCount} service${candidate.serviceCount === 1 ? '' : 's'}`,
    `${candidate.scannedFileCount} files`,
  ].join(' · ')

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-accent/45 bg-accent/10' : 'border-border bg-black/10 hover:bg-white/5',
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Folder className={cn('h-3.5 w-3.5 flex-shrink-0', selected ? 'text-accent' : 'text-muted')} />
          <span className={cn('truncate text-xs font-semibold', selected ? 'text-accent' : 'text-text')}>
            {candidate.name}
          </span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-2 text-[10px] text-muted">
          {detail}
          {selected && <CheckCircle2 className="h-3.5 w-3.5 text-accent" />}
        </span>
      </span>
      <span className="mt-1 block truncate font-mono text-[10px] text-muted">{shortPath(candidate.path)}</span>
      {(candidate.projectTypes.length > 0 || candidate.services.length > 0) && (
        <span className="mt-2 flex flex-wrap gap-1">
          {[...candidate.projectTypes, ...candidate.services].slice(0, 5).map(label => (
            <span key={label} className="rounded-full border border-border bg-black/15 px-2 py-0.5 text-[10px] text-muted">
              {label}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

function ScanSummary({ result }: { result: ProjectScanResult }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-lg border border-border bg-black/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-muted">Env Keys</p>
        <p className="mt-1 text-sm font-semibold text-text">{result.envKeys.length}</p>
      </div>
      <div className="rounded-lg border border-border bg-black/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-muted">Env Files</p>
        <p className="mt-1 text-sm font-semibold text-text">{result.envFiles.length}</p>
      </div>
      <div className="rounded-lg border border-border bg-black/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-muted">Services</p>
        <p className="mt-1 text-sm font-semibold text-text">{result.services.length}</p>
      </div>
    </div>
  )
}

function ProjectEnvironmentRail({
  project,
  providers,
}: {
  project: EnvProject
  providers: Provider[]
}) {
  const environments = getProjectEnvironmentDisplays(project, providers)

  return (
    <section className="rounded-xl border border-border bg-black/10 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Environments</p>
        <span className="text-[10px] text-muted">
          {environments.filter(environment => environment.configured).length}/{environments.length} linked
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {environments.map(environment => (
          <div
            key={environment.id}
            className="min-w-0 rounded-lg border border-border bg-surface/80 px-3 py-2"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {environment.kind === 'local'
                  ? <Laptop className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary" />
                  : <Cloud className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary" />}
                <span className="truncate text-xs font-semibold text-text">{environment.name}</span>
              </span>
              <EnvChip scope={environment.scope} />
            </div>
            <p className="mt-1 truncate text-[10px] text-muted" title={environment.targetLabel}>
              {environment.targetLabel}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className={cn('text-[10px] font-medium', environmentStatusClass(environment.status))}>
                {environmentStatusLabel(environment.status)}
              </span>
              <span className="text-[10px] text-muted">{environment.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function environmentStatusLabel(status: ProjectEnvironmentStatus): string {
  switch (status) {
    case 'ready': return 'Ready'
    case 'needs-mapping': return 'Needs maps'
    case 'needs-target': return 'Needs target'
    case 'unavailable': return 'Unavailable'
  }
}

function environmentStatusClass(status: ProjectEnvironmentStatus): string {
  switch (status) {
    case 'ready': return 'text-emerald-300'
    case 'needs-mapping': return 'text-amber-300'
    case 'needs-target': return 'text-rose-300'
    case 'unavailable': return 'text-muted'
  }
}

function EnvReviewGroups({
  groups,
  allSecrets,
  onChange,
  onStage,
  onUseSuggestion,
}: {
  groups: EnvReviewGroup[]
  allSecrets: SecretOption[]
  onChange: (index: number, entry: EnvEntry) => void
  onStage: (item: EnvReviewItem) => void
  onUseSuggestion: (item: EnvReviewItem) => void
}) {
  const items = groups.flatMap(group => group.items)
  const mappedCount = items.filter(item => item.entry.secretId && item.entry.fieldKey).length
  const stagedCount = items.filter(item => item.index >= 0).length
  const suggestedCount = items.filter(item => item.suggestion).length

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Env Organization</p>
          <p className="mt-1 text-[11px] text-muted">
            {groups.length} env/service group{groups.length === 1 ? '' : 's'} · {stagedCount}/{items.length} staged · {mappedCount} mapped · {suggestedCount} suggested
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-black/10 px-3 py-2 text-xs text-muted">
          No env keys detected yet.
        </p>
      ) : (
        <div className="max-h-[340px] overflow-y-auto rounded-xl border border-border bg-black/10">
          {groups.map(group => (
            <div key={group.id} className="border-b border-border/60 last:border-b-0">
              <div className="flex items-center justify-between gap-3 bg-white/[0.025] px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    {group.envLabel}
                  </span>
                  <span className="rounded-full border border-border bg-black/20 px-2 py-0.5 text-[10px] text-text-secondary">
                    {group.serviceLabel}
                  </span>
                </div>
                <span className="flex-shrink-0 text-[10px] text-muted">
                  {group.items.length} key{group.items.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="divide-y divide-border/45">
                {group.items.map(item => {
                  const selectedSecret = allSecrets.find(option => option.secret.id === item.entry.secretId)?.secret
                  const fieldOptions = selectedSecret?.fields.filter(field => field.value) ?? []
                  const mapped = Boolean(item.entry.secretId && item.entry.fieldKey)
                  const staged = item.index >= 0
                  return (
                    <div key={`${group.id}:${item.key.key}:${item.index}`} className="grid gap-2 px-3 py-2.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(220px,1fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-[11px] font-medium text-text">{item.key.key}</span>
                          <span className={cn(
                            'flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider',
                            mapped
                              ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                              : staged
                                ? 'border-amber-400/25 bg-amber-400/10 text-amber-300'
                                : 'border-border bg-black/20 text-muted',
                          )}>
                            {mapped ? 'mapped' : staged ? 'staged' : 'not staged'}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-muted">{item.sourceLabel}</p>
                        {item.suggestion && !mapped && (
                          <p className="mt-1 truncate text-[10px] text-emerald-300/90">
                            {item.suggestion.reason}: {item.suggestion.folderName} / {item.suggestion.secretName} · {item.suggestion.fieldKey}
                          </p>
                        )}
                      </div>

                      {staged ? (
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_140px] gap-2">
                          <select
                            value={item.entry.secretId}
                            onChange={event => onChange(item.index, {
                              ...item.entry,
                              secretId: event.target.value,
                              fieldId: undefined,
                              fieldKey: '',
                            })}
                            className="min-w-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none transition-colors focus:border-accent"
                          >
                            <option value="">Select secret</option>
                            {allSecrets.map(({ secret, folderName }) => (
                              <option key={secret.id} value={secret.id}>
                                {folderName} / {secret.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={item.entry.fieldId ?? item.entry.fieldKey}
                            onChange={event => {
                              const field = fieldOptions.find(option => option.id === event.target.value)
                                ?? fieldOptions.find(option => option.key === event.target.value)
                              onChange(item.index, {
                                ...item.entry,
                                fieldId: field?.id,
                                fieldKey: field?.key ?? '',
                              })
                            }}
                            disabled={!item.entry.secretId}
                            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none transition-colors focus:border-accent disabled:opacity-40"
                          >
                            <option value="">Field</option>
                            {fieldOptions.map((field, fieldIndex) => (
                              <option key={field.id ?? `${field.key}-${fieldIndex}`} value={field.id ?? field.key}>{field.key}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => onStage(item)} className="justify-center lg:w-[160px]">
                          <Plus className="h-3.5 w-3.5" />
                          Stage key
                        </Button>
                      )}

                      <div className="flex justify-end gap-2">
                        {item.suggestion && !mapped && (
                          <Button variant="outline" size="sm" onClick={() => onUseSuggestion(item)}>
                            <Sparkles className="h-3.5 w-3.5" />
                            Use match
                          </Button>
                        )}
                        {mapped && staged && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onChange(item.index, { ...item.entry, secretId: '', fieldKey: '' })}
                            title="Clear mapping"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── EnvProjectsModal ───────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  initialProjectId?: string | null
  startNew?: boolean
}

export default function EnvProjectsModal({ onClose, initialProjectId = null, startNew = false }: Props) {
  const { state, addEnvProject, updateEnvProject, deleteEnvProject, setPreferences } = useVault()
  const projects   = state.vault?.envProjects ?? []
  const providers  = state.vault?.providers ?? []
  const allSecrets = state.vault ? flatSecrets(state.vault.root) : []
  const pinnedOrder = state.vault?.preferences?.localDashboardPinnedOrder ?? []
  const initialSelectedId = startNew
    ? null
    : initialProjectId && projects.some(project => project.id === initialProjectId)
      ? initialProjectId
      : projects[0]?.id ?? null

  const [selectedId,  setSelectedId]  = useState<string | null>(initialSelectedId)
  const [showNewForm, setShowNewForm] = useState(startNew)
  const [createFlow, setCreateFlow] = useState<CreateFlow>('scan-parent')

  // Local editable copy of the selected project
  const baseProject  = projects.find(p => p.id === selectedId) ?? null
  const baseLocalEnvironment = baseProject ? projectLocalEnvironment(baseProject) : null
  const isCreating = showNewForm && selectedId === null
  const [localName,        setLocalName]        = useState(startNew ? '' : baseProject?.name ?? '')
  const [localPath,        setLocalPath]        = useState(startNew ? '' : baseLocalEnvironment?.path ?? '')
  const [localEntries,     setLocalEntries]     = useState<EnvEntry[]>(startNew ? [] : baseLocalEnvironment?.entries ?? [])
  const [localGitignore,   setLocalGitignore]   = useState(startNew ? true : baseLocalEnvironment?.addToGitignore ?? true)
  const [saving,           setSaving]           = useState(false)
  const [exporting,        setExporting]        = useState(false)
  const [exportResult,     setExportResult]     = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirmExport,    setConfirmExport]    = useState(false)
  const [confirmText,      setConfirmText]      = useState('')
  const [parentPath,       setParentPath]       = useState('')
  const [discovering,      setDiscovering]      = useState(false)
  const [discovery,        setDiscovery]        = useState<ProjectDiscoverResult | null>(null)
  const [scanning,         setScanning]         = useState(false)
  const [scanSummary,      setScanSummary]      = useState<ProjectScanResult | null>(null)
  const [createError,      setCreateError]      = useState<string | null>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const selectProject = (p: EnvProject) => {
    const localEnvironment = projectLocalEnvironment(p)
    setSelectedId(p.id)
    setShowNewForm(false)
    setLocalName(p.name)
    setLocalPath(localEnvironment.path ?? '')
    setLocalEntries(localEnvironment.entries ?? [])
    setLocalGitignore(localEnvironment.addToGitignore ?? true)
    setExportResult(null)
    setConfirmExport(false)
    setConfirmText('')
    setCreateError(null)
  }

  const startCreating = () => {
    setSelectedId(null)
    setShowNewForm(true)
    setLocalName('')
    setLocalPath('')
    setLocalEntries([])
    setLocalGitignore(true)
    setCreateFlow('scan-parent')
    setParentPath('')
    setDiscovery(null)
    setScanSummary(null)
    setCreateError(null)
    setExportResult(null)
    setConfirmExport(false)
    setConfirmText('')
  }

  const togglePinnedProject = (projectId: string) => {
    void setPreferences({
      localDashboardPinnedOrder: togglePinnedTargetOrder(pinnedOrder, 'project', projectId),
    })
  }

  const cancelCreating = () => {
    setShowNewForm(false)
    const fallback = initialProjectId
      ? projects.find(project => project.id === initialProjectId) ?? projects[0]
      : projects[0]
    if (fallback) selectProject(fallback)
    else {
      setSelectedId(null)
      setLocalName('')
      setLocalPath('')
      setLocalEntries([])
      setLocalGitignore(true)
    }
    setParentPath('')
    setDiscovery(null)
    setScanSummary(null)
    setCreateError(null)
  }

  const exitCreateFlow = () => {
    if (startNew) onClose()
    else cancelCreating()
  }

  const chooseCreateFlow = (flow: CreateFlow) => {
    if (flow === createFlow) return
    setCreateFlow(flow)
    setParentPath('')
    setDiscovery(null)
    setLocalPath('')
    setLocalName('')
    setLocalEntries([])
    setScanSummary(null)
    setCreateError(null)
  }

  const handleCreate = async () => {
    if (!localName.trim()) return
    if (!localPath.trim()) {
      setCreateError('Attach a local folder first.')
      return
    }
    try {
      const created = await addEnvProject({
        name: localName.trim(),
        path: localPath,
        entries: localEntries,
        addToGitignore: localGitignore,
      })
      setShowNewForm(false)
      if (created) selectProject(created)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the Project')
    }
  }

  const handlePickFolder = async () => {
    const path = await window.vault.pickFolder({
      purpose: 'project-local-path',
      ...(!isCreating && baseProject ? { projectId: baseProject.id } : {}),
    })
    if (path) setLocalPath(path)
  }

  const scanSelectedFolder = async (path: string) => {
    setScanning(true)
    setCreateError(null)
    try {
      const res = await window.vault.scanProject({
        path,
        ...(!isCreating && baseProject ? { projectId: baseProject.id } : {}),
      })
      if (!res.success || !res.result) throw new Error(res.error ?? 'Project scan failed')
      setScanSummary(res.result)
      setLocalEntries(entriesFromScan(res.result))
      if (!localName.trim()) setLocalName(pathName(path))
    } catch (err) {
      setScanSummary(null)
      setLocalEntries([])
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const handlePickParentFolder = async () => {
    const path = await window.vault.pickFolder({ purpose: 'scan-parent' })
    if (!path) return
    setCreateFlow('scan-parent')
    setParentPath(path)
    setLocalPath('')
    setLocalName('')
    setLocalEntries([])
    setScanSummary(null)
    setCreateError(null)
    setDiscovering(true)
    try {
      const res = await window.vault.discoverProjects({
        parentPath: path,
      })
      if (!res.success || !res.result) throw new Error(res.error ?? 'Project discovery failed')
      setDiscovery(res.result)
    } catch (err) {
      setDiscovery(null)
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscovering(false)
    }
  }

  const handlePickExactProjectFolder = async () => {
    const path = await window.vault.pickFolder({ purpose: 'project-local-path' })
    if (!path) return
    setCreateFlow('choose-folder')
    setParentPath('')
    setDiscovery(null)
    setLocalPath(path)
    setLocalName(pathName(path))
    await scanSelectedFolder(path)
  }

  const selectCandidate = async (candidate: ProjectScanCandidate) => {
    setLocalPath(candidate.path)
    setLocalName(candidate.name)
    await scanSelectedFolder(candidate.path)
  }

  const handleSave = async () => {
    if (!baseProject) return
    setSaving(true)
    try {
      await updateEnvProject(withLocalProjectEnvironment({
        ...baseProject,
        name: localName.trim() || baseProject.name,
      }, {
        path: localPath,
        entries: localEntries,
        addToGitignore: localGitignore,
      }))
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    if (!baseProject || !localPath) return
    if (!confirmExport) {
      setConfirmExport(true)
      setConfirmText('')
      setExportResult(null)
      return
    }
    if (confirmText !== PLAINTEXT_CONFIRM_PHRASE) return

    setExporting(true); setExportResult(null)

    try {
      const configuredProject = withLocalProjectEnvironment({
        ...baseProject,
        name: localName.trim() || baseProject.name,
      }, {
        path: localPath,
        entries: localEntries,
        addToGitignore: localGitignore,
      })
      await updateEnvProject(configuredProject)

      const selections = localEntries
        .filter(e => e.envKey && e.secretId && e.fieldKey)
        .map(e => ({ envKey: e.envKey, secretId: e.secretId, fieldId: e.fieldId, fieldKey: e.fieldKey }))

      const res = await exportEnvWithReplaceConfirmation(window.vault.exportEnv, {
        projectId: configuredProject.id,
        environmentId: projectLocalEnvironment(configuredProject).id,
      }, () => window.confirm(replaceEnvFileConfirmation({
        localPath,
        valueCount: selections.length,
        addToGitignore: localGitignore,
      })))
      setExportResult({ ok: res.success, msg: res.success ? `.env written to ${localPath}` : (res.error ?? 'Export failed') })
      if (res.success) {
        try {
          await updateEnvProject(withLocalProjectEnvironment(configuredProject, {
            path: localPath,
            entries: localEntries,
            addToGitignore: localGitignore,
            lastSyncAt: new Date().toISOString(),
          }))
        } catch {
          setExportResult({
            ok: true,
            msg: `.env written to ${localPath}; Vaultage could not update the last-sync timestamp`,
          })
        }
        setConfirmExport(false)
        setConfirmText('')
      }
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async (p: EnvProject) => {
    const environments = getProjectEnvironments(p)
    if (!confirm(projectDeletionConfirmation({
      projectName: p.name,
      environmentCount: environments.length,
      mappingCount: environments.reduce((count, environment) => count + environment.entries.length, 0),
    }))) return
    await deleteEnvProject(p.id)
    const remaining = projects.filter(x => x.id !== p.id)
    if (remaining.length) selectProject(remaining[0])
    else {
      setSelectedId(null)
      setShowNewForm(false)
      setLocalName('')
      setLocalPath('')
      setLocalEntries([])
      setLocalGitignore(true)
    }
  }

  const addEntry = () => {
    setLocalEntries(prev => [...prev, { envKey: '', secretId: '', fieldKey: '' }])
  }

  const updateEntry = (i: number, e: EnvEntry) => {
    setLocalEntries(prev => prev.map((x, j) => j === i ? e : x))
  }

  const removeEntry = (i: number) => {
    setLocalEntries(prev => prev.filter((_, j) => j !== i))
  }

  const envReviewGroups = useMemo(
    () => buildEnvReviewGroups(scanSummary, localEntries, allSecrets),
    [scanSummary, localEntries, allSecrets],
  )

  const stageReviewItem = (item: EnvReviewItem) => {
    setLocalEntries(prev => [
      ...prev,
      {
        envKey: item.key.key,
        secretId: '',
        fieldKey: '',
      },
    ])
  }

  const useReviewSuggestion = (item: EnvReviewItem) => {
    if (!item.suggestion) return
    const nextEntry = {
      ...item.entry,
      envKey: item.key.key,
      secretId: item.suggestion.secretId,
      fieldKey: item.suggestion.fieldKey,
    }
    if (item.index >= 0) updateEntry(item.index, nextEntry)
    else setLocalEntries(prev => [...prev, nextEntry])
  }

  const exportableEntryCount = localEntries.filter(e => e.envKey && e.secretId && e.fieldKey).length
  const canExport =
    !exporting &&
    Boolean(localPath) &&
    exportableEntryCount > 0 &&
    (!confirmExport || confirmText === PLAINTEXT_CONFIRM_PHRASE)
  const projectPreview: EnvProject = baseProject
    ? withLocalProjectEnvironment({ ...baseProject, name: localName.trim() || baseProject.name }, {
        path: localPath,
        entries: localEntries,
        addToGitignore: localGitignore,
      })
    : {
        id: 'draft-project',
        name: localName.trim() || 'New Project',
        path: localPath,
        entries: localEntries,
        addToGitignore: localGitignore,
        environments: [{
          id: 'draft-local',
          name: 'Local',
          scope: 'development',
          kind: 'local',
          path: localPath,
          entries: localEntries,
          addToGitignore: localGitignore,
        }],
      }

  if (isCreating) {
    const importStatus = discovering
      ? 'Scanning parent folder…'
      : scanning
        ? 'Reading project files…'
        : localPath
          ? `${localEntries.length} env key${localEntries.length === 1 ? '' : 's'} ready for mapping`
          : 'Attach a local folder to continue.'

    return createPortal(
      <div className="liquid-modal-overlay fixed inset-0 z-50 flex items-center justify-center no-drag">
        <div className="liquid-modal-shell flex h-[640px] max-h-[88vh] w-[min(64rem,calc(100vw-2rem))] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border shadow-modal">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Projects</p>
              <h2 className="mt-1 text-sm font-semibold text-text">New Project</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
              aria-label="Close import project"
            >
              <X className="h-4 w-4" />
            </button>
          </div>


          <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
            <aside className="flex min-h-0 flex-col border-r border-border">
              <div className="border-b border-border px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Source</p>
                <div className="mt-3 grid gap-2">
                  <CreateFlowOption
                    active={createFlow === 'scan-parent'}
                    title="Scan parent folder"
                    detail="Find projects inside one workspace."
                    onClick={() => chooseCreateFlow('scan-parent')}
                  />
                  <CreateFlowOption
                    active={createFlow === 'choose-folder'}
                    title="Attach local folder"
                    detail="Use one exact local workspace."
                    onClick={() => chooseCreateFlow('choose-folder')}
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {createFlow === 'scan-parent' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Parent Folder</p>
                      <div className="rounded-lg border border-border bg-black/10 p-3">
                        <p className="truncate font-mono text-xs text-text/80">
                          {parentPath || <span className="text-muted italic">No parent selected</span>}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handlePickParentFolder}
                          disabled={discovering}
                          className="mt-3 w-full"
                        >
                          {discovering && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                          {discovering ? 'Scanning…' : 'Choose Parent'}
                        </Button>
                      </div>
                    </div>

                    {discovery ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Detected Projects</p>
                          <span className="text-[10px] text-muted">{discovery.candidates.length}</span>
                        </div>
                        {discovery.candidates.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border bg-black/10 px-4 py-6 text-center">
                            <Search className="mx-auto h-4 w-4 text-muted" />
                            <p className="mt-2 text-xs font-medium text-text">No local folders found</p>
                            <p className="mt-1 text-[11px] text-muted">Attach the local folder directly.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {discovery.candidates.map(candidate => (
                              <CandidateRow
                                key={candidate.path}
                                candidate={candidate}
                                selected={localPath === candidate.path}
                                onSelect={() => { void selectCandidate(candidate) }}
                              />
                            ))}
                          </div>
                        )}
                        {discovery.warnings.length > 0 && (
                          <p className="text-[10px] leading-relaxed text-muted">
                            {discovery.warnings[0]}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-black/10 px-4 py-6 text-center">
                        <Search className="mx-auto h-4 w-4 text-muted" />
                        <p className="mt-2 text-xs font-medium text-text">Pick a workspace to scan</p>
                        <p className="mt-1 text-[11px] text-muted">Vaultage will list local app folders found one level down.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Local Folder</p>
                    <div className="rounded-lg border border-border bg-black/10 p-3">
                      <p className="truncate font-mono text-xs text-text/80">
                        {localPath || <span className="text-muted italic">No local folder</span>}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePickExactProjectFolder}
                        disabled={scanning}
                        className="mt-3 w-full"
                      >
                        {scanning && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                        {scanning ? 'Scanning…' : 'Choose Folder'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <main className="flex min-h-0 flex-col">
              <div className="flex-shrink-0 border-b border-border px-6 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Review</p>
                <h3 className="mt-1 text-sm font-semibold text-text">
                  {localPath ? 'Project details' : 'No local folder attached'}
                </h3>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {createError && (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                    {createError}
                  </div>
                )}

                {!localPath ? (
                  <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-black/10 px-8 text-center">
                    <div className="max-w-[300px]">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-black/20">
                        <Folder className="h-5 w-5 text-muted" />
                      </div>
                      <h4 className="mt-4 text-sm font-semibold text-text">Attach a local folder</h4>
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        Scan a parent folder and select a detected app, or choose the local folder directly.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <section className="space-y-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Project Name</p>
                        <input
                          autoFocus
                          value={localName}
                          onChange={e => setLocalName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && localName.trim()) void handleCreate(); if (e.key === 'Escape') exitCreateFlow() }}
                          className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text outline-none transition-colors placeholder:text-muted focus:border-accent"
                          placeholder="Project name"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Folder</p>
                        <p className="mt-2 truncate rounded-lg border border-border bg-black/10 px-3 py-2 font-mono text-[11px] text-muted">
                          {localPath}
                        </p>
                      </div>
                    </section>

                    <ProjectEnvironmentRail project={projectPreview} providers={providers} />

                    {scanSummary ? (
                      <ScanSummary result={scanSummary} />
                    ) : (
                      <div className="rounded-lg border border-border bg-black/10 px-3 py-2 text-xs text-muted">
                        {scanning ? 'Scanning project…' : 'Project scan has not run yet.'}
                      </div>
                    )}

                    <EnvReviewGroups
                      groups={envReviewGroups}
                      allSecrets={allSecrets}
                      onChange={updateEntry}
                      onStage={stageReviewItem}
                      onUseSuggestion={useReviewSuggestion}
                    />

                    <section className="flex items-center justify-between rounded-lg border border-border bg-black/10 px-3 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-text">Add .env to .gitignore</p>
                        <p className="mt-0.5 text-[11px] text-muted">Keeps generated env files out of source control.</p>
                      </div>
                      <Switch
                        checked={localGitignore}
                        onCheckedChange={setLocalGitignore}
                        aria-label="Add .env to .gitignore automatically"
                        className="h-5 w-9 flex-shrink-0 border border-border data-[state=checked]:border-accent/40 data-[state=unchecked]:bg-black/20"
                      />
                    </section>
                  </div>
                )}
              </div>
            </main>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3 border-t border-border px-6 py-3">
            <p className="min-w-0 flex-1 truncate text-xs text-muted">{importStatus}</p>
            <Button variant="ghost" onClick={exitCreateFlow}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!localName.trim() || !localPath || scanning || discovering}>
              {scanning || discovering ? 'Scanning…' : 'Create Project'}
            </Button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  return createPortal(
    <div className="liquid-modal-overlay fixed inset-0 z-50 flex items-center justify-center no-drag">
      <div className="liquid-modal-shell flex h-[600px] max-h-[88vh] w-[min(64rem,calc(100vw-2rem))] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border shadow-modal">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text">Projects</h2>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left: project list */}
          <div className="w-52 border-r border-border flex flex-col flex-shrink-0">
            <div className="flex-1 overflow-y-auto py-2">
              {projects.length === 0 && (
                <p className="px-4 py-3 text-xs text-muted italic">No projects yet</p>
              )}
              {projects.map(p => (
                <div key={p.id}
                  className={cn('flex w-full items-start gap-1 px-4 py-2.5 transition-colors',
                    p.id === selectedId ? 'bg-accent/10' : 'hover:bg-white/5')}>
                  <button type="button" onClick={() => selectProject(p)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', p.id === selectedId ? 'text-accent' : 'text-text')}>
                        {p.name}
                      </span>
                    </span>
                    <p className="mt-0.5 truncate text-[10px] text-muted">
                      {projectPrimaryLocalPath(p) ? projectPrimaryLocalPath(p).split('/').slice(-2).join('/') : 'No local folder'}
                    </p>
                    {p.lastExportAt && (
                      <p className="mt-0.5 text-[10px] text-muted">
                        Exported {new Date(p.lastExportAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                  </button>
                  <PinTargetButton
                    compact
                    pinned={isPinnedTarget(pinnedOrder, 'project', p.id)}
                    targetLabel="Project"
                    onClick={event => {
                      event.stopPropagation()
                      togglePinnedProject(p.id)
                    }}
                  />
                </div>
              ))}
              {isCreating && (
                <button
                  type="button"
                  className="w-full bg-accent/10 px-4 py-2.5 text-left transition-colors"
                >
                  <p className="truncate text-xs font-medium text-accent">
                    {localName.trim() || 'New Project'}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted">
                    {localPath ? localPath.split('/').slice(-2).join('/') : 'Draft project'}
                  </p>
                </button>
              )}
            </div>

            {/* New project */}
            <div className="border-t border-border p-3">
              <Button
                onClick={startCreating}
                className="w-full"
                size="sm"
                variant={isCreating ? 'outline' : 'default'}
                disabled={isCreating}
              >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Project
              </Button>
            </div>
          </div>

          {/* Right: project detail */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {isCreating ? (
              <>
                <div className="border-b border-border px-6 py-4 flex-shrink-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Add Project</p>
                  <h3 className="mt-1 text-sm font-semibold text-text">Create Project</h3>
                </div>

                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                  <div className="grid grid-cols-2 gap-3">
                    <CreateFlowOption
                      active={createFlow === 'scan-parent'}
                      title="Scan parent folder"
                      detail="Find local app folders inside a workspace."
                      onClick={() => setCreateFlow('scan-parent')}
                    />
                    <CreateFlowOption
                      active={createFlow === 'choose-folder'}
                      title="Attach local folder"
                      detail="Use one exact local workspace."
                      onClick={() => setCreateFlow('choose-folder')}
                    />
                  </div>

                  {createFlow === 'scan-parent' ? (
                    <section className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Parent Folder</p>
                          <p className="mt-1 truncate font-mono text-xs text-text/80">
                            {parentPath || <span className="text-muted italic">No parent selected</span>}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={handlePickParentFolder} disabled={discovering}>
                          {discovering ? 'Scanning…' : 'Choose Parent'}
                        </Button>
                      </div>

                      {discovery && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Local Folders</p>
                            <span className="text-[10px] text-muted">{discovery.candidates.length}</span>
                          </div>
                          {discovery.candidates.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border bg-black/10 px-4 py-6 text-center">
                              <p className="text-xs font-medium text-text">No local folders found</p>
                              <p className="mt-1 text-[11px] text-muted">Attach the local folder directly instead.</p>
                            </div>
                          ) : (
                            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                              {discovery.candidates.map(candidate => (
                                <CandidateRow
                                  key={candidate.path}
                                  candidate={candidate}
                                  selected={localPath === candidate.path}
                                  onSelect={() => { void selectCandidate(candidate) }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  ) : (
                    <section className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Local Folder</p>
                        <p className="mt-1 truncate font-mono text-xs text-text/80">
                          {localPath || <span className="text-muted italic">No local folder</span>}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={handlePickExactProjectFolder} disabled={scanning}>
                        {scanning ? 'Scanning…' : 'Choose Folder'}
                      </Button>
                    </section>
                  )}

                  {createError && (
                    <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                      {createError}
                    </div>
                  )}

                  {localPath && (
                    <section className="space-y-4 rounded-xl border border-border bg-black/10 p-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Selected Project</p>
                        <input
                          autoFocus
                          value={localName}
                          onChange={e => setLocalName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && localName.trim()) handleCreate(); if (e.key === 'Escape') cancelCreating() }}
                          className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text outline-none transition-colors placeholder:text-muted focus:border-accent"
                          placeholder="Project name"
                        />
                        <p className="mt-2 truncate font-mono text-[11px] text-muted">{localPath}</p>
                      </div>

                      {scanSummary && <ScanSummary result={scanSummary} />}

                      <ProjectEnvironmentRail project={projectPreview} providers={providers} />

                      <EnvReviewGroups
                        groups={envReviewGroups}
                        allSecrets={allSecrets}
                        onChange={updateEntry}
                        onStage={stageReviewItem}
                        onUseSuggestion={useReviewSuggestion}
                      />

                      <div className="flex items-center justify-between border-t border-border/60 pt-3">
                        <span className="text-xs text-muted">Add .env to .gitignore</span>
                        <Switch
                          checked={localGitignore}
                          onCheckedChange={setLocalGitignore}
                          aria-label="Add .env to .gitignore automatically"
                          className="h-5 w-9 flex-shrink-0 border border-border data-[state=checked]:border-accent/40 data-[state=unchecked]:bg-black/20"
                        />
                      </div>
                    </section>
                  )}
                </div>

                <div className="border-t border-border px-6 py-3 flex items-center gap-3 flex-shrink-0">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted">
                    {localPath ? `${localEntries.length} env key${localEntries.length === 1 ? '' : 's'} ready for mapping` : 'Attach a local folder to continue.'}
                  </p>
                  <Button variant="ghost" onClick={cancelCreating}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={!localName.trim() || !localPath || scanning || discovering}>
                    Create Project
                  </Button>
                </div>
              </>
            ) : !baseProject ? (
              <div className="flex-1 flex flex-col items-center justify-center overflow-hidden bg-black/10">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-black/10">
                  <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-text mb-1">No Project Selected</h3>
                  <p className="text-xs text-muted text-center max-w-[250px]">
                  Select a Project to map vault fields to its local environment, or create a new one.
                </p>
              </div>
            ) : (
              <>
                {/* Project toolbar */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
                  <input value={localName} onChange={e => setLocalName(e.target.value)}
                    className="flex-1 bg-transparent text-sm font-medium text-text outline-none placeholder-muted"
                    placeholder="Project name" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(baseProject)}
                    title="Delete this encrypted project configuration; saved secrets, source files, and existing .env files remain."
                    className="flex-shrink-0"
                  >
                    Delete
                  </Button>
                </div>

                <fieldset className="contents">
                {/* Config */}
                <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-3">
                  <ProjectEnvironmentRail project={projectPreview} providers={providers} />

                  {/* Path */}
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-muted uppercase tracking-wider w-16 flex-shrink-0">Local</p>
                    <p className="flex-1 text-xs font-mono text-text/80 truncate min-w-0">
                      {localPath || <span className="text-muted italic">No local folder</span>}
                    </p>
                    <Button variant="outline" size="sm" onClick={handlePickFolder} className="flex-shrink-0">
                      Change…
                    </Button>
                  </div>

                  {/* Gitignore */}
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-muted uppercase tracking-wider w-16 flex-shrink-0">Gitignore</p>
                    <Switch
                      checked={localGitignore}
                      onCheckedChange={setLocalGitignore}
                      aria-label="Add .env to .gitignore automatically"
                      className="h-5 w-9 flex-shrink-0 border border-border data-[state=checked]:border-accent/40 data-[state=unchecked]:bg-black/20"
                    />
                    <p className="text-xs text-muted">Add .env to .gitignore automatically</p>
                  </div>
                </div>

                {/* Entries */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] text-muted uppercase tracking-wider">Env Mappings</p>
                    <Button variant="outline" size="sm" onClick={addEntry}>Add Mapping</Button>
                  </div>

                  {localEntries.length === 0 ? (
                    <p className="text-xs text-muted italic py-4">
                      No mappings yet. Add a mapping to connect a secret field to an env variable.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {localEntries.map((entry, i) => (
                        <EntryRow
                          key={i}
                          entry={entry}
                          allSecrets={allSecrets}
                          onChange={e => updateEntry(i, e)}
                          onDelete={() => removeEntry(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {confirmExport && (
                  <div className="mx-5 mb-3 space-y-2 px-3 py-2.5 bg-danger/10 border border-danger/30 rounded-lg flex-shrink-0">
                    <div className="flex items-start gap-2">
                      <svg className="w-3.5 h-3.5 text-danger flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <p className="text-[10px] text-danger">
                        This writes {exportableEntryCount} secret{exportableEntryCount === 1 ? '' : 's'} to a plaintext .env file. Type {PLAINTEXT_CONFIRM_PHRASE}; Touch ID is required on supported Macs before the file is written.
                      </p>
                    </div>
                    <input
                      autoFocus
                      value={confirmText}
                      onChange={e => setConfirmText(e.target.value)}
                      placeholder={PLAINTEXT_CONFIRM_PHRASE}
                      className="w-full bg-surface border border-danger/40 rounded-lg px-2.5 py-1.5 text-xs text-text placeholder-muted outline-none focus:border-danger font-mono"
                    />
                  </div>
                )}

                {/* Footer */}
                <div className="border-t border-border px-5 py-3 flex items-center gap-3 flex-shrink-0">
                  {exportResult && (
                    <p className={cn('text-xs flex-1 truncate', exportResult.ok ? 'text-emerald-400' : 'text-danger')}>
                      {exportResult.msg}
                    </p>
                  )}
                  {!exportResult && <div className="flex-1" />}

                  <Button variant="ghost" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    onClick={handleExport}
                    disabled={!canExport}
                    variant={confirmExport ? 'destructive' : 'default'}
                  >
                    {exporting ? 'Exporting…' : confirmExport ? 'Write .env Unencrypted' : 'Export .env'}
                  </Button>
                </div>
                </fieldset>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
