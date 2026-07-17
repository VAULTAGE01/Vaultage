import { describe, expect, it, vi } from 'vitest'
import { authorizeCommercialExtensionHandoff } from './featureCapabilityGate'

const handoff = {
  source: 'browser-extension' as const,
  mode: 'agent' as const,
  receivedAt: '2026-07-14T00:00:00.000Z',
}

describe('commercial extension handoff gate', () => {
  it('rejects direct signed handoff delivery when entitlement is missing or expired', async () => {
    const requireCapability = vi.fn(async () => { throw new Error('expired') })
    await expect(authorizeCommercialExtensionHandoff({ requireCapability }, handoff)).resolves.toBeNull()
    expect(requireCapability).toHaveBeenCalledWith('pro.extension')
  })

  it('allows a released Pro extension capability', async () => {
    const requireCapability = vi.fn(async () => undefined)
    await expect(authorizeCommercialExtensionHandoff({ requireCapability }, handoff)).resolves.toEqual(handoff)
  })
})
