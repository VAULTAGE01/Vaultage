import { describe, expect, it } from 'vitest'
import { resolveAllowedExternalUrl } from './externalUrlPolicy'

describe('external URL policy', () => {
  it('allows known product and provider destinations', () => {
    expect(resolveAllowedExternalUrl('https://vaultage.dev/contact?source=desktop')).toBe('https://vaultage.dev/contact?source=desktop')
    expect(resolveAllowedExternalUrl('https://dash.cloudflare.com/?to=/:account/billing')).toBe('https://dash.cloudflare.com/?to=/:account/billing')
    expect(resolveAllowedExternalUrl('https://vercel.com/account/billing')).toBe('https://vercel.com/account/billing')
    expect(resolveAllowedExternalUrl('https://dashboard.doppler.com/workplace/billing')).toBe('https://dashboard.doppler.com/workplace/billing')
  })

  it('blocks arbitrary, credentialed, and non-HTTPS destinations', () => {
    expect(resolveAllowedExternalUrl('https://evil.example.com/collect')).toBeNull()
    expect(resolveAllowedExternalUrl('https://vaultage.dev.evil.example.com/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('https://token@vaultage.dev/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('http://vaultage.dev/contact')).toBeNull()
    expect(resolveAllowedExternalUrl('not a url')).toBeNull()
  })
})
