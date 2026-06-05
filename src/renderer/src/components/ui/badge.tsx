import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-accent/10 text-accent border border-accent/20',
        secondary:   'bg-surface text-muted border border-border',
        destructive: 'bg-danger/10 text-danger border border-danger/20',
        outline:     'border border-border text-muted',
        warning:     'bg-warning/10 text-warning border border-warning/20',
        info:        'bg-info/10 text-info border border-info/20',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
