import { describe, expect, it } from 'vitest'
import {
  collectHostedBillingReturnArgs,
  findHostedBillingReturnArg,
  parseHostedBillingReturnUrl,
} from './billingReturnHandoff'

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

  it('collects the bounded canonical startup arguments for a cold launch', () => {
    // Given more valid billing returns than the startup queue may retain, plus
    // unrelated and malformed arguments.
    const returns = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ].map(state => `vaultage://billing/checkout/returned?state=${state}`)

    // When Electron supplies the initial process arguments.
    const collected = collectHostedBillingReturnArgs([
      'Vaultage',
      returns[0] ?? '',
      'vaultage://extension/open?mode=agent',
      ...returns.slice(1),
      'vaultage://billing/checkout/returned?state=malformed',
    ])

    // Then only the newest four canonical returns survive for later runtime
    // reconciliation.
    expect(collected).toEqual(returns.slice(-4))
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
