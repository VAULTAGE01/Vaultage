import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-card border border-border text-text shadow-modal rounded-xl text-xs',
          description: 'text-muted',
          actionButton: 'bg-accent text-black',
          cancelButton: 'bg-surface text-muted',
          success: 'border-accent/30 bg-accent/5 text-accent',
          error: 'border-danger/30 bg-danger/5 text-danger',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
