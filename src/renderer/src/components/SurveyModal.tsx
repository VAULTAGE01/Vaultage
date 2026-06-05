import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ExternalLink, Gift, ShieldCheck } from 'lucide-react'
import { GiftModel } from './GiftModel'

interface SurveyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTakeSurvey: () => Promise<boolean>
  loading?: boolean
}

export function SurveyModal({ open, onOpenChange, onTakeSurvey, loading = false }: SurveyModalProps) {
  const handleTakeSurvey = async () => {
    const opened = await onTakeSurvey()
    if (opened) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-lg overflow-hidden p-0 no-drag">
        <DialogHeader className="px-6 pb-5 pt-4 text-center">
          <GiftModel size="modal" interactive={false} className="mx-auto mb-1" />
          <DialogTitle>Help shape Vaultage</DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
            Answer 5 short questions about how you work with secrets, services, and AI tools. It opens in your browser, and we do not collect desktop app usage analytics.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-6 pb-5 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              Private by default
            </div>
            <p className="text-xs leading-relaxed text-muted-light">
              The survey is optional and separate from the app. No vault, project, or behavior data is sent.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
              <Gift className="h-4 w-4 text-amber-300" />
              Small thank you
            </div>
            <p className="text-xs leading-relaxed text-muted-light">
              Survey responders can claim 1 free month of Pro credit when paid plans are available.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
	          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} title="Close this survey prompt. Shortcut: Esc">
            Maybe Later
          </Button>
	          <Button 
	            onClick={handleTakeSurvey}
	            disabled={loading}
	            className="gap-2"
	            title="Open the optional Vaultage research survey. Shortcut: Enter"
	          >
            {loading ? 'Opening...' : 'Open survey'}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
