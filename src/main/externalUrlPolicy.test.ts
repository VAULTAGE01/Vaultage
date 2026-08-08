import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveAllowedExternalUrl } from './externalUrlPolicy'

function providerResearchDocumentationUrls(
  researchManifest = new URL('../renderer/src/lib/providerResearch.ts', import.meta.url),
): string[] {
  if (!existsSync(researchManifest)) return []
  const source = readFileSync(researchManifest, 'utf8')
  return [...source.matchAll(/url: '([^']+)'/g)].map(match => match[1]).filter(url => url !== undefined)
}

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

  it('allows only the exact staging account-security destination', () => {
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account')).toBe('https://staging.vaultage.dev/account')
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account?section=security')).toBe('https://staging.vaultage.dev/account?section=security')
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/')).toBeNull()
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account?next=evil')).toBeNull()
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account?section=profile')).toBeNull()
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account?section=security&next=evil')).toBeNull()
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account?section=security#unexpected')).toBeNull()
    expect(resolveAllowedExternalUrl('https://staging.vaultage.dev/account/other')).toBeNull()
  })

  it.each([
    'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
    'https://docs.railway.com/integrations/oauth',
    'https://docs.aws.amazon.com/secretsmanager/latest/apireference/Welcome.html',
    'https://firebase.google.com/docs/functions/config-env',
    'https://supabase.com/docs/guides/functions/secrets',
  ])('allows an exact official paid-beta documentation host: %s', url => {
    // Given an official documentation URL exposed by the provider details drawer.
    // When it crosses the main-process external URL boundary.
    // Then the exact HTTPS destination is allowed.
    expect(resolveAllowedExternalUrl(url)).toBe(url)
  })

  it('allows every official Services research document present in this edition', () => {
    // Given the canonical provider research documents present in this edition.
    const documentationUrls = providerResearchDocumentationUrls()

    // When each URL crosses the main-process external URL boundary.
    const blockedUrls = documentationUrls.filter(url => resolveAllowedExternalUrl(url) !== url)

    // Then no documentation action becomes a dead button.
    expect(blockedUrls).toEqual([])
  })

  it('treats an edition without the private Services manifest as an empty catalog', () => {
    // Given an edition where the private provider research source is absent.
    const absentManifest = new URL('./fixtures/absent-providerResearch.ts', import.meta.url)

    // When its documentation set is inspected.
    const documentationUrls = providerResearchDocumentationUrls(absentManifest)

    // Then the open-source boundary remains valid without weakening explicit host checks.
    expect(documentationUrls).toEqual([])
  })

  it.each([
    'https://railway.com.example.test/docs',
    'https://developers.cloudflare.com.example.test/docs',
    'http://docs.aws.amazon.com/secretsmanager/',
  ])('rejects lookalike or non-HTTPS documentation destinations: %s', url => {
    // Given an untrusted URL resembling an approved documentation destination.
    // When it crosses the main-process external URL boundary.
    // Then it remains blocked.
    expect(resolveAllowedExternalUrl(url)).toBeNull()
  })

  it('blocks arbitrary, credentialed, and non-HTTPS destinations', () => {
    expect(resolveAllowedExternalUrl('https://evil.example.com/collect')).toBeNull()
    expect(resolveAllowedExternalUrl('https://vaultage.dev.evil.example.com/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('https://token@vaultage.dev/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('http://vaultage.dev/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('not a url')).toBeNull()
  })
})
