import { getEnvVisual } from '@/lib/env'
import { cn } from '@/lib/utils'

interface EnvChipProps {
  scope?:   string | null
  size?:    'sm' | 'md'
  variant?: 'soft' | 'solid' | 'outline'
  showDot?: boolean
  className?: string
}

/**
 * Single source of truth for rendering an environment tag.
 * - `soft`    : default — translucent fill + light border
 * - `solid`   : full color, for hero placements (e.g. SecretDetail header)
 * - `outline` : just border + colored text, for low-density rows
 */
export function EnvChip({ scope, size = 'sm', variant = 'soft', showDot = false, className }: EnvChipProps) {
  const v = getEnvVisual(scope)
  const isSm = size === 'sm'

  const baseStyle: React.CSSProperties =
    variant === 'solid'
      ? { background: v.color, color: '#0a0a0a', border: '1px solid transparent' }
    : variant === 'outline'
      ? { background: 'transparent', color: v.textRgba, border: `1px solid ${v.borderRgba}` }
      : { background: v.bgRgba, color: v.textRgba, border: `1px solid ${v.borderRgba}` }

  return (
    <span
      title={v.label}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium uppercase tracking-wider whitespace-nowrap',
        isSm ? 'text-[9px] px-1.5 py-px' : 'text-[10px] px-2 py-0.5',
        className,
      )}
      style={baseStyle}
    >
      {showDot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: variant === 'solid' ? 'rgba(0,0,0,0.5)' : v.color }}
        />
      )}
      {isSm ? v.short : v.label}
    </span>
  )
}

/**
 * 3px left border accent used on rows / cards to convey env at a glance,
 * without taking up character width. Pair with `EnvChip` for redundancy
 * (color + label, accessibility-friendly).
 */
export function envBorderStyle(scope?: string | null): React.CSSProperties {
  const v = getEnvVisual(scope)
  return {
    borderLeft: `3px solid ${scope ? v.color : 'transparent'}`,
  }
}
