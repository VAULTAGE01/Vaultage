import { describe, expect, it } from 'vitest'
import { resolveAllowedExternalUrl } from './externalUrlPolicy'

describe('external URL policy', () => {
  it('allows known product and provider destinations', () => {
    expect(resolveAllowedExternalUrl('https://vaultage.dev/contact?source=desktop')).toBe('https://vaultage.dev/contact?source=desktop')
    expect(resolveAllowedExternalUrl('https://dash.cloudflare.com/?to=/:account/billing')).toBe('https://dash.cloudflare.com/?to=/:account/billing')
    expect(resolveAllowedExternalUrl('https://github.com/settings/personal-access-tokens/new')).toBe('https://github.com/settings/personal-access-tokens/new')
    expect(resolveAllowedExternalUrl('https://gitlab.com/-/user_settings/personal_access_tokens')).toBe('https://gitlab.com/-/user_settings/personal_access_tokens')
    expect(resolveAllowedExternalUrl('https://vercel.com/account/billing')).toBe('https://vercel.com/account/billing')
    expect(resolveAllowedExternalUrl('https://dashboard.doppler.com/workplace/billing')).toBe('https://dashboard.doppler.com/workplace/billing')
    for (const url of [
      'https://console.aws.amazon.com/billing/home',
      'https://console.cloud.google.com/billing',
      'https://console.firebase.google.com/project/demo/usage/details',
      'https://portal.azure.com/#view/Microsoft_Azure_Billing/ModernBillingMenuBlade/~/Overview',
      'https://platform.openai.com/settings/organization/billing/overview',
      'https://supabase.com/dashboard/project/demo/settings/billing',
      'https://app.netlify.com/user/billing',
      'https://console.twilio.com/us1/billing/overview',
      'https://resend.com/billing',
    ]) {
      expect(resolveAllowedExternalUrl(url)).toBe(url)
    }
  })

  it('blocks arbitrary, credentialed, and non-HTTPS destinations', () => {
    expect(resolveAllowedExternalUrl('https://evil.example.com/collect')).toBeNull()
    expect(resolveAllowedExternalUrl('https://vaultage.dev.evil.example.com/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('https://token@vaultage.dev/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('http://vaultage.dev/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('not a url')).toBeNull()
  })
})
