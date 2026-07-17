import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

function formatType(type: string): string {
  return type
    .split('.')
    .map(part => part.replace(/_/g, ' '))
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ')
}

function summarizeDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(', ')}`
      if (typeof value === 'object') return `${key}: ${JSON.stringify(value)}`
      return `${key}: ${String(value)}`
    })
  return entries.length > 0 ? entries.join(' · ') : 'No details'
}

interface Props { onClose: () => void }

export default function AuditLogModal({ onClose }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [verification, setVerification] = useState<AuditVerification>({ ok: true })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const loadAudit = async () => {
    setLoading(true); setError(null); setExportResult(null)
    try {
      const res = await window.vault.auditRead()
      if (!res.success) {
        setError(res.error ?? 'Could not load audit log')
        return
      }
      setEvents(res.events ?? [])
      setVerification(res.verification ?? { ok: true })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAudit()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const visibleEvents = useMemo(() => [...events].reverse(), [events])

  const handleExport = async () => {
    setExporting(true); setExportResult(null)
    try {
      const res = await window.vault.auditExportJson()
      if (res.cancelled) return
      setExportResult({
        ok:  res.success,
        msg: res.success ? `Exported to ${res.path}` : (res.error ?? 'Export failed'),
      })
      if (res.success) await loadAudit()
    } finally {
      setExporting(false)
    }
  }

  return createPortal(
    <div className="liquid-modal-overlay fixed inset-0 z-50 flex items-center justify-center no-drag">
      <div className="liquid-modal-shell flex h-[580px] w-[820px] flex-col overflow-hidden rounded-2xl border shadow-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-text">Audit Log</h2>
            <p className={cn('text-[10px] mt-1', verification.ok ? 'text-emerald-400' : 'text-danger')}>
              {verification.ok
                ? `${events.length} events · hash chain verified`
                : `Verification failed at event ${verification.index + 1}: ${verification.reason}`}
            </p>
          </div>
	          <button onClick={onClose} title="Close audit log. Shortcut: Esc" className="text-muted hover:text-text transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-shrink-0">
	            <button onClick={loadAudit} disabled={loading}
	              title="Refresh audit events. Shortcut: Enter"
	              className="px-3 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-text hover:border-border/60 disabled:opacity-40 transition-colors">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
	            <button onClick={handleExport} disabled={exporting || events.length === 0}
	              title="Export audit events as JSON. Shortcut: Enter"
	              className="px-3 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-text hover:border-border/60 disabled:opacity-40 transition-colors">
              {exporting ? 'Exporting…' : 'Export JSON'}
            </button>
            {exportResult && (
              <p className={cn('text-xs flex-1 truncate', exportResult.ok ? 'text-emerald-400' : 'text-danger')}>
                {exportResult.msg}
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <p className="text-xs text-muted">Loading audit events…</p>
            ) : error ? (
              <p className="text-xs text-danger">{error}</p>
            ) : visibleEvents.length === 0 ? (
              <p className="text-xs text-muted italic">No audit events yet.</p>
            ) : (
              <div className="space-y-2">
                {visibleEvents.map((event) => (
                  <div key={event.id} className="border border-border rounded-xl px-4 py-3 bg-surface">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-semibold text-text">{formatType(event.type)}</p>
                          <p className="text-[10px] text-muted">
                            {new Date(event.timestamp).toLocaleString()}
                          </p>
                        </div>
                        <p className="text-[10px] text-text-secondary truncate">
                          {summarizeDetails(event.details)}
                        </p>
                      </div>
                      <p className="text-[10px] font-mono text-muted flex-shrink-0">
                        {event.hash.slice(0, 10)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex-shrink-0">
	          <button onClick={onClose}
	            title="Close audit log. Shortcut: Esc"
	            className="w-full px-4 py-2 rounded-xl text-xs text-muted border border-border hover:text-text hover:border-border/60 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
