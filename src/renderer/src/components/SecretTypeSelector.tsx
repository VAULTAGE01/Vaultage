import { useRef, type KeyboardEvent } from 'react'
import {
  BadgeCheck,
  Braces,
  Image,
  KeyRound,
  SlidersHorizontal,
  SquareTerminal,
  StickyNote,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SecretType } from '../types'
import { SECRET_TYPE_LABELS } from '../types'

export const SECRET_TYPE_ORDER: readonly SecretType[] = [
  'password',
  'apiKey',
  'sshKey',
  'secureNote',
  'custom',
  'image',
  'certificate',
]

const TYPE_ICONS: Record<SecretType, LucideIcon> = {
  password: KeyRound,
  apiKey: Braces,
  sshKey: SquareTerminal,
  secureNote: StickyNote,
  custom: SlidersHorizontal,
  image: Image,
  certificate: BadgeCheck,
}

export function nextSecretTypeForKey(current: SecretType, key: string): SecretType {
  const index = SECRET_TYPE_ORDER.indexOf(current)
  if (key === 'Home') return SECRET_TYPE_ORDER[0]!
  if (key === 'End') return SECRET_TYPE_ORDER.at(-1)!
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return SECRET_TYPE_ORDER[(index + 1) % SECRET_TYPE_ORDER.length]!
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return SECRET_TYPE_ORDER[(index - 1 + SECRET_TYPE_ORDER.length) % SECRET_TYPE_ORDER.length]!
  }
  return current
}

export default function SecretTypeSelector({
  value,
  onChange,
}: {
  value: SecretType
  onChange: (value: SecretType) => void
}) {
  const refs = useRef<Partial<Record<SecretType, HTMLButtonElement | null>>>({})

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextSecretTypeForKey(value, event.key)
    if (next === value) return
    event.preventDefault()
    onChange(next)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Secret type"
      className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6"
    >
      {SECRET_TYPE_ORDER.map(secretType => {
        const Icon = TYPE_ICONS[secretType]
        const selected = value === secretType
        const label = SECRET_TYPE_LABELS[secretType]
        return (
          <button
            key={secretType}
            ref={node => { refs.current[secretType] = node }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            tabIndex={selected ? 0 : -1}
            title={label}
            data-secret-type={secretType}
            onClick={() => onChange(secretType)}
            onKeyDown={handleKeyDown}
            className={cn(
              'group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/75 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected
                ? 'border-accent/60 bg-accent/15 text-accent shadow-[0_0_18px_rgba(0,255,135,0.08)]'
                : 'border-border bg-black/10 text-muted hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-text',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="min-h-5 max-w-full text-[10px] font-medium leading-tight">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
