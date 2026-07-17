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
    <TooltipProvider delayDuration={650} skipDelayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={10}
          className="max-w-72 rounded-xl border border-white/[0.10] bg-card/95 px-3.5 py-2.5 shadow-modal backdrop-blur-xl animate-slide-up"
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-text">{label}</p>
              <kbd className="rounded-md border border-white/10 bg-white/[0.055] px-1.5 py-0.5 font-mono text-[10px] leading-none text-text-secondary">
                {shortcut}
              </kbd>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-light">{description}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
