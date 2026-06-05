import type { ReactNode } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type ActionTooltipProps = {
  label: string
  description: string
  shortcut?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  children: ReactNode
}

export function ActionTooltip({
  label,
  description,
  shortcut = 'Enter',
  side = 'top',
  align = 'center',
  children,
}: ActionTooltipProps) {
  return (
    <TooltipProvider delayDuration={280}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} align={align} className="max-w-72 px-3 py-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-text">{label}</p>
              <kbd className="rounded-md border border-white/10 bg-white/[0.055] px-1.5 py-0.5 font-mono text-[10px] leading-none text-text-secondary">
                {shortcut}
              </kbd>
            </div>
            <p className="text-[11px] leading-snug text-muted">{description}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
