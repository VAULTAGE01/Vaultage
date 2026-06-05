import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted',
        'focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none transition-colors',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
