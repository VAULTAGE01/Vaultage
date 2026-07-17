import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import {
  masterPasswordPolicyError,
  masterPasswordStrength,
} from '../../../shared/passwordPolicy'

function strength(pw: string): { score: number; label: string; color: string } {
  const { score: s } = masterPasswordStrength(pw)
  const levels = [
    { label: '',           color: 'bg-border' },
    { label: 'Very weak',  color: 'bg-danger' },
    { label: 'Weak',       color: 'bg-orange-400' },
    { label: 'Fair',       color: 'bg-yellow-400' },
    { label: 'Strong',     color: 'bg-emerald-400' },
    { label: 'Very strong', color: 'bg-accent' },
  ]
  return { score: s, ...levels[Math.min(s, 5)] }
}

interface Props { onClose: () => void }

export default function ChangePasswordModal({ onClose }: Props) {
  const [current, setCurrent] = useState('')
  const [next,    setNext]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [done,    setDone]    = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const pw       = strength(next)
  const mismatch = confirm.length > 0 && confirm !== next
  const policyError = next.length > 0 ? masterPasswordPolicyError(next, 'New password') : null
  const canSave  = current && !policyError && next === confirm && !saving

  const handleSave = async () => {
    setError(null); setSaving(true)
    try {
      const res = await window.vault.changePassword({ current, next })
      if (res.success) {
        setDone(true)
        setTimeout(onClose, 1500)
      } else {
        setError(res.wrongPassword ? 'Current password is incorrect' : (res.error ?? 'Failed'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="liquid-modal-overlay fixed inset-0 z-50 flex items-center justify-center no-drag">
      <div className="liquid-modal-shell flex w-[400px] flex-col overflow-hidden rounded-2xl border shadow-modal">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text">Change Master Password</h2>
	          <button onClick={onClose} title="Close this modal. Shortcut: Esc" className="text-muted hover:text-text transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <svg className="w-10 h-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
              <p className="text-sm text-text font-medium">Password changed</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider">Current Password</label>
                <input
                  autoFocus data-secure-input="true" type="password" value={current}
                  onChange={e => { setCurrent(e.target.value); setError(null) }}
                  onKeyDown={e => e.key === 'Enter' && canSave && handleSave()}
                  className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider">New Password</label>
                <input
                  data-secure-input="true" type="password" value={next} onChange={e => setNext(e.target.value)}
                  className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors"
                />
                {next.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 h-1">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={cn('flex-1 rounded-full transition-colors', i <= pw.score ? pw.color : 'bg-border')} />
                      ))}
                    </div>
                    {pw.label && <p className="text-[10px] text-muted mt-1">{pw.label}</p>}
                    {policyError && <p className="text-[10px] text-danger mt-1">{policyError}</p>}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider">Confirm New Password</label>
                <input
                  data-secure-input="true" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && canSave && handleSave()}
                  className={cn(
                    'mt-1 w-full bg-surface border rounded-lg px-3 py-2 text-sm text-text outline-none transition-colors',
                    mismatch ? 'border-danger' : 'border-border focus:border-accent'
                  )}
                />
                {mismatch && <p className="text-[10px] text-danger mt-1">Passwords do not match</p>}
              </div>

              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          )}
        </div>

        {!done && (
          <div className="flex gap-2 px-6 pb-5">
	            <button onClick={onClose}
	              title="Cancel changing the master password. Shortcut: Esc"
	              className="flex-1 px-4 py-2 rounded-xl text-xs text-muted border border-border hover:text-text hover:border-border/60 transition-colors">
              Cancel
            </button>
	            <button onClick={handleSave} disabled={!canSave}
	              title="Save the new master password. Shortcut: Enter"
	              className="flex-1 px-4 py-2 rounded-xl text-xs font-semibold bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-black transition-colors">
              {saving ? 'Changing…' : 'Change Password'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
