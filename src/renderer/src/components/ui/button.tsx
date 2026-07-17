import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:     'bg-accent text-black hover:bg-accent-hover shadow-glow-sm',
        destructive: 'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20',
        outline:     'border border-border bg-transparent text-text hover:bg-white/5 hover:border-border-light',
        secondary:   'bg-surface text-text hover:bg-card border border-border',
        ghost:       'text-muted hover:text-text hover:bg-white/5',
        link:        'text-accent underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-7 px-3 text-xs',
        lg:      'h-11 px-6',
        icon:    'h-8 w-8 !border-0 !border-transparent !bg-transparent p-0 !shadow-none hover:!border-transparent hover:!bg-transparent',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
