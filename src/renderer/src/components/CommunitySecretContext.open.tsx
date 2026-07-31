import { useEffect, useMemo, useState } from 'react'
import { Activity, FolderKanban, ShieldCheck } from 'lucide-react'
import type { AuditEvent } from '../../../shared/auditIpcContracts'
import type { EnvProject, VaultSecret } from '../types'

type Props = {
  secret: VaultSecret
  projects: EnvProject[]
  folderName: string
  revealCopyAllowed: boolean
  onRevealCopyChange: (allowed: boolean) => void
}

export default function CommunitySecretContext({
  secret,
  projects,
  folderName,
  revealCopyAllowed,
  onRevealCopyChange,
}: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [accessAllowed, setAccessAllowed] = useState(revealCopyAllowed)
  const projectUsages = useMemo(() => projects.flatMap(project => (
    project.entries
      .filter(entry => entry.secretId === secret.id)
      .map(entry => `${project.name} · ${entry.envKey || 'Unmapped key'}`)
  )), [projects, secret.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.vault.auditRead()
      .then(result => {
        if (cancelled) return
        const matching = result.success
          ? (result.events ?? []).filter(event => auditMatchesSecret(event, secret.id)).reverse().slice(0, 3)
          : []
        setEvents(matching)
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [secret.id])

  useEffect(() => setAccessAllowed(revealCopyAllowed), [revealCopyAllowed])

  return (
    <section className="mt-6 grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold text-text">Context</h2>
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <Summary label="Folder" value={folderName} />
          <Summary label="Scope" value={secret.scope || 'Vault'} />
          <Summary label="Created" value={formatDate(secret.createdAt)} />
          <Summary label="Updated" value={formatDate(secret.updatedAt)} />
          <Summary label="Copies" value={String(secret.usageCount ?? 0)} />
          <Summary label="Last used" value={secret.lastUsedAt ? formatDate(secret.lastUsedAt) : 'Never'} />
        </dl>
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">In use by</p>
          {projectUsages.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {projectUsages.map(usage => (
                <span key={usage} className="rounded-full border border-border bg-black/20 px-2 py-1 text-[10px] text-text-secondary">
                  {usage}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">No project mappings.</p>
          )}
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-black/10 px-3 py-2">
          <input
            type="checkbox"
            aria-label="Allow reveal and copy"
            checked={accessAllowed}
            onChange={event => {
              setAccessAllowed(event.target.checked)
              onRevealCopyChange(event.target.checked)
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium text-text">Allow reveal and copy</span>
            <span className="mt-0.5 block text-[10px] text-muted">Disable to keep this record view-only until re-enabled.</span>
          </span>
        </label>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold text-text">Activity</h2>
        </div>
        <div className="mt-3 divide-y divide-border">
          {loading ? (
            <p className="py-4 text-xs text-muted">Loading activity…</p>
          ) : events.length > 0 ? events.map(event => (
            <div key={event.id} className="flex items-start gap-3 py-3">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-300" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-text">{auditLabel(event.type)}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted">{auditDetail(event)}</p>
              </div>
              <time className="text-[10px] text-muted">{formatDate(event.timestamp)}</time>
            </div>
          )) : (
            <p className="py-4 text-xs text-muted">No recorded activity for this secret.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 truncate text-xs text-text-secondary">{value}</dd>
    </div>
  )
}

function auditMatchesSecret(event: AuditEvent, secretId: string): boolean {
  return event.details.vaultItemId === secretId
    || event.details.secretId === secretId
    || event.details.scopeId === secretId
}

function auditLabel(type: string): string {
  return type.split(/[.:_-]/u).filter(Boolean).map(word => (
    `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  )).join(' ')
}

function auditDetail(event: AuditEvent): string {
  const field = typeof event.details.field === 'string' ? `Field: ${event.details.field}` : null
  const format = typeof event.details.format === 'string' ? event.details.format : null
  return [field, format].filter(Boolean).join(' · ') || 'Local secret activity'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
