import { describe, expect, it } from 'vitest'
import { findHostedBillingReturnArg, parseHostedBillingReturnUrl } from './billingReturnHandoff'

const token = '123e4567-e89b-42d3-a456-426614174000'

describe('hosted billing return protocol', () => {
  it('accepts the exact returned and cancelled checkout routes', () => {
    expect(parseHostedBillingReturnUrl(returnUrl('returned'))).toEqual({
      kind: 'checkout', outcome: 'returned', returnToken: token,
    })
    expect(parseHostedBillingReturnUrl(returnUrl('cancelled'))).toEqual({
      kind: 'checkout', outcome: 'cancelled', returnToken: token,
    })
  })

  it('finds a billing return without treating extension URLs as billing returns', () => {
    expect(findHostedBillingReturnArg([
      'Vaultage',
      'vaultage://extension/open?mode=agent',
      returnUrl('returned'),
    ])).toMatchObject({ outcome: 'returned', returnToken: token })
    expect(findHostedBillingReturnArg(['vaultage://extension/open?mode=agent'])).toBeNull()
  })

  it.each([
    'https://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111',
    'vaultage://extension/checkout/returned?state=11111111-1111-4111-8111-111111111111',
    'vaultage://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111&extra=1',
    'vaultage://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111&state=22222222-2222-4222-8222-222222222222',
    'vaultage://billing/checkout/returned?state=not-a-token',
    'vaultage://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111#fragment',
    'vaultage://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111&',
    'vaultage://billing/checkout/returned?state%3D11111111-1111-4111-8111-111111111111',
    'vaultage://billing/checkout/returned?%73tate=11111111-1111-4111-8111-111111111111',
    'vaultage://billing/checkout/returned?state=11111111-1111-4111-8111-%311111111111',
    'VAULTAGE://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111',
    'vaultage://billing/checkout/returned?state=11111111-1111-4111-8111-111111111111'.toUpperCase(),
    returnUrl('returned').replace(token, token.toUpperCase()),
  ])('rejects a foreign or ambiguous URL', rawUrl => {
    expect(parseHostedBillingReturnUrl(rawUrl)).toBeNull()
  })

  it('rejects oversized protocol input', () => {
    expect(parseHostedBillingReturnUrl(`${returnUrl('returned')}${'x'.repeat(512)}`)).toBeNull()
  })
})

function returnUrl(outcome: 'returned' | 'cancelled'): string {
  return `vaultage://billing/checkout/${outcome}?state=${token}`
}
