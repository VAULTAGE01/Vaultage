import { useMemo, useState } from 'react'
import { Clock3, ExternalLink, Gift, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useVault } from '../vaultContext'
import type { OnboardingResearchSurveyStatus } from '../types'
import {
  ONBOARDING_RESEARCH_REMIND_LATER_DELAY_MS,
  onboardingResearchSurveyUrl,
  shouldShowOnboardingResearchPrompt,
} from '../lib/onboardingResearch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export default function OnboardingResearchPrompt() {
  const { state, setPreferences } = useVault()
  const [dismissedForSession, setDismissedForSession] = useState(false)
  const [savingChoice, setSavingChoice] = useState<OnboardingResearchSurveyStatus | null>(null)
  const surveyPreference = state.vault?.preferences?.onboardingResearchSurvey

  const open = Boolean(state.vault) && !dismissedForSession &&
    shouldShowOnboardingResearchPrompt(surveyPreference, state.justCompletedSetup)

  const externalUrl = useMemo(() => onboardingResearchSurveyUrl(), [])

  const recordChoice = async (status: OnboardingResearchSurveyStatus): Promise<boolean> => {
    const now = new Date()
    const reminderAt = status === 'remind_later'
      ? new Date(now.getTime() + ONBOARDING_RESEARCH_REMIND_LATER_DELAY_MS).toISOString()
      : undefined

    setSavingChoice(status)
    setDismissedForSession(true)

    try {
      await setPreferences({
        onboardingResearchSurvey: {
          status,
          promptedAt: surveyPreference?.promptedAt ?? now.toISOString(),
          respondedAt: now.toISOString(),
          reminderAt,
        },
      })
      return true
    } catch {
      setDismissedForSession(false)
      toast.error('Could not save your survey preference')
      return false
    } finally {
      setSavingChoice(null)
    }
  }

  const handleOpenSurvey = async () => {
    setSavingChoice('opened')
    const result = await window.vault.openExternal(externalUrl)

    if (!result.success) {
      setSavingChoice(null)
      toast.error(result.error ?? 'Could not open the survey')
      return
    }

    const saved = await recordChoice('opened')
    if (saved) toast.success('Survey opened in your browser')
  }

  const handleRemindLater = () => {
    void recordChoice('remind_later')
  }

  const handleSkip = () => {
    void recordChoice('skipped')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && savingChoice === null) handleRemindLater()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0 no-drag">
        <DialogHeader className="px-6 py-5">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="info">Optional</Badge>
            <Badge variant="secondary">Privacy-first</Badge>
          </div>
          <DialogTitle className="text-lg">Help us learn without tracking the app</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-text-secondary">
            Vaultage does not collect desktop usage telemetry, behavior analytics, or project activity.
            If you are willing, answer 5 short questions on our website so we can understand who we are building for.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface/60 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                <ShieldCheck className="h-4 w-4 text-info" />
                What stays private
              </div>
              <p className="text-xs leading-relaxed text-muted-light">
                No app events, no project scanning, and no behavior timeline are sent from the desktop app.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface/60 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                <Gift className="h-4 w-4 text-warning" />
                Thank-you credit
              </div>
              <p className="text-xs leading-relaxed text-muted-light">
                Complete the survey to claim 1 free month of Pro credit when paid plans are available.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/60 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
              The survey asks about
            </p>
            <div className="grid gap-2 text-xs text-muted-light sm:grid-cols-3">
              <span className="rounded-lg bg-surface px-3 py-2">Your role or cohort</span>
              <span className="rounded-lg bg-surface px-3 py-2">Coding experience</span>
              <span className="rounded-lg bg-surface px-3 py-2">Project types</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center">
	          <Button
	            variant="ghost"
	            onClick={handleSkip}
	            disabled={savingChoice !== null}
	            className="justify-center"
	            title="Skip the optional onboarding survey. Shortcut: Esc"
	          >
            Skip
          </Button>
	          <Button
	            variant="outline"
	            onClick={handleRemindLater}
	            disabled={savingChoice !== null}
	            className="justify-center"
	            title="Dismiss this survey prompt for now. Shortcut: Enter"
	          >
            <Clock3 className="h-3.5 w-3.5" />
            Maybe later
          </Button>
	          <Button
	            onClick={handleOpenSurvey}
	            disabled={savingChoice !== null}
	            className="justify-center"
	            title="Open the optional 5-question onboarding survey. Shortcut: Enter"
	          >
            {savingChoice === 'opened' ? 'Opening...' : 'Answer 5 questions'}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
