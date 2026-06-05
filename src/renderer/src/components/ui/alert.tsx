import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative w-full rounded-xl border px-4 py-3 text-xs [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg+div]:pl-6',
  {
    variants: {
      variant: {
        default:     'bg-surface border-border text-muted',
        destructive: 'bg-danger/8 border-danger/20 text-danger',
        warning:     'bg-warning/8 border-warning/20 text-warning',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
)
Alert.displayName = 'Alert'

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('leading-relaxed', className)} {...props} />
  )
)
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertDescription }
