import type { ButtonHTMLAttributes } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActionTooltip } from './ActionTooltip'

interface PinSecretButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pinned: boolean
  compact?: boolean
}

interface PinTargetButtonProps extends PinSecretButtonProps {
  targetLabel: string
}

export function PinTargetButton({
  pinned,
  compact,
  targetLabel,
  className,
  title,
  ...props
}: PinTargetButtonProps) {
  const label = pinned ? `Unpin ${targetLabel}` : `Pin ${targetLabel}`
  const description = title
    ?? (pinned
      ? `Remove this ${targetLabel.toLowerCase()} from its dashboard pinned grid.`
      : `Pin this ${targetLabel.toLowerCase()} to its dashboard for quick access.`)

  return (
    <ActionTooltip label={label} description={description} shortcut="Enter" side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pinned}
        className={cn(
          'inline-flex flex-shrink-0 items-center justify-center rounded-lg border-0 bg-transparent transition-colors focus:outline-none focus:ring-1 focus:ring-accent/60',
          compact ? 'h-5 w-5' : 'h-7 w-7',
          pinned
            ? 'text-amber-300 hover:text-amber-200'
            : 'text-muted hover:text-amber-300',
          className,
        )}
        {...props}
      >
        <Star className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5', pinned && 'fill-current')} />
      </button>
    </ActionTooltip>
  )
}

export function PinSecretButton(props: PinSecretButtonProps) {
  return <PinTargetButton {...props} targetLabel="Secret" />
}
