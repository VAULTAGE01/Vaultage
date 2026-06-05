import { useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

type ShortcutRow = [label: string, keys: string[]]

const navigationRows: ShortcutRow[] = [
  ['Search secrets', ['⌘', 'K']],
  ['Vault', ['⌘', '1']],
  ['Projects', ['⌘', '2']],
  ...(__VAULTAGE_OPEN_CORE__ ? [] : [['Services', ['⌘', '3']] as ShortcutRow]),
]

const sections = [
  {
    title: 'Navigation',
    rows: navigationRows,
  },
  {
    title: 'Actions',
    rows: [
      ['New item in current mode', ['⌘', 'N']],
      ['Import secrets', ['⌘', '⇧', 'I']],
      ['Export vault', ['⌘', '⇧', 'E']],
      ['Lock vault', ['⌘', 'L']],
    ] as ShortcutRow[],
  },
  {
    title: 'Settings',
    rows: [
      ['Open settings', ['⌘', ',']],
      ['Show shortcuts', ['⌘', '/']],
      ['Close modal', ['Esc']],
    ] as ShortcutRow[],
  },
]

function Keycap({ children }: { children: string }) {
  return (
    <span className="min-w-6 rounded-md border border-border bg-white/[0.06] px-1.5 py-0.5 text-center text-[11px] font-semibold text-text-secondary shadow-sm">
      {children}
    </span>
  )
}

export default function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogHeader className="px-6 py-5 border-b border-border">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-text-secondary">
            Fast paths for moving around Vaultage without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {sections.map(section => (
            <div key={section.title} className="rounded-xl border border-border bg-surface/60 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/60">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {section.title}
                </p>
              </div>
              <div>
                {section.rows.map(row => {
                  const [label, keys] = row
                  return (
                    <div key={label} className="flex items-center justify-between gap-4 px-3 py-2.5 border-b border-border/40 last:border-0">
                      <p className="text-xs text-text">{label}</p>
                      <div className="flex items-center gap-1">
                        {keys.map(key => <Keycap key={`${label}-${key}`}>{key}</Keycap>)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
