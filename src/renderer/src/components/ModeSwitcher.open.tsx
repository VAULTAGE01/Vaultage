import { useMode, type AppMode } from '../modeContext.open'
import { FolderKanban, KeyRound } from 'lucide-react'
import type { ElementType } from 'react'

const MODES: { mode: AppMode; label: string; icon: ElementType }[] = [
  { mode: 'local', label: 'Vault', icon: KeyRound },
  { mode: 'projects', label: 'Projects', icon: FolderKanban },
]

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export default function ModeSwitcher() {
  const { mode, setMode } = useMode()

  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-black/20 p-1">
      {MODES.map(item => {
        const Icon = item.icon
        const selected = mode === item.mode
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => { void setMode(item.mode) }}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors',
              selected ? 'bg-white/10 text-text shadow-sm' : 'text-muted hover:bg-white/[0.06] hover:text-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
