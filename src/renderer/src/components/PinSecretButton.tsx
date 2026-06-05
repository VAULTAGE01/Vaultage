import type { ButtonHTMLAttributes } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActionTooltip } from './ActionTooltip'

interface PinSecretButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pinned: boolean
  compact?: boolean
}

export function PinSecretButton({
  pinned,
  compact,
  className,
  title,
  ...props
}: PinSecretButtonProps) {
  const label = pinned ? 'Unpin Secret' : 'Pin Secret'
  const description = title
    ?? (pinned ? 'Remove this secret from the dashboard pinned grid.' : 'Pin this secret to the dashboard for quick access.')

  return (
    <ActionTooltip label={label} description={description} shortcut="Enter" side="top">
      <button
        type="button"
        aria-pressed={pinned}
        className={cn(
          'inline-flex flex-shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-1 focus:ring-accent/60',
          compact ? 'h-5 w-5' : 'h-7 w-7',
          pinned
            ? 'border-amber-400/35 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'
            : 'border-white/[0.08] bg-white/[0.03] text-muted hover:border-amber-400/30 hover:bg-amber-400/10 hover:text-amber-300',
          className,
        )}
        {...props}
      >
        <Star className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5', pinned && 'fill-current')} />
      </button>
    </ActionTooltip>
  )
}
