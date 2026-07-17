import type { OnboardingResearchSurveyPreference } from '../types'

export const ONBOARDING_RESEARCH_REMIND_LATER_DELAY_MS = 3 * 24 * 60 * 60 * 1000

const DEFAULT_SURVEY_URL = 'https://vaultage.dev/onboarding-survey'

export function onboardingResearchSurveyUrl(): string {
  const configuredUrl = import.meta.env.VITE_ONBOARDING_RESEARCH_URL || DEFAULT_SURVEY_URL

  try {
    const url = new URL(configuredUrl)
    url.searchParams.set('source', 'desktop_onboarding')
    url.searchParams.set('product', 'vaultage')
    url.searchParams.set('privacy_model', 'no_desktop_usage_tracking')
    return url.toString()
  } catch {
    return `${DEFAULT_SURVEY_URL}?source=desktop_onboarding&product=vaultage&privacy_model=no_desktop_usage_tracking`
  }
}

function isOnboardingResearchReminderDue(reminderAt?: string): boolean {
  if (!reminderAt) return false
  const timestamp = Date.parse(reminderAt)
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function isOnboardingResearchComplete(preference?: OnboardingResearchSurveyPreference): boolean {
  return preference?.status === 'completed'
}

export function shouldShowOnboardingResearchPrompt(
  preference: OnboardingResearchSurveyPreference | undefined,
  justCompletedSetup: boolean,
): boolean {
  if (isOnboardingResearchComplete(preference)) return false
  return (
    (justCompletedSetup && !preference) ||
    (preference?.status === 'remind_later' && isOnboardingResearchReminderDue(preference.reminderAt))
  )
}
