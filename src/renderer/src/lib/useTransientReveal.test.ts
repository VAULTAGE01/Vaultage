import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  maskTransientReveal,
  TRANSIENT_REVEAL_TTL_MS,
  TransientRevealGate,
} from './useTransientReveal'

afterEach(() => {
  vi.useRealTimers()
})

describe('transient reveal lifecycle', () => {
  it('uses a fixed, bounded reveal lifetime', () => {
    expect(TRANSIENT_REVEAL_TTL_MS).toBe(30_000)
  })

  it('rejects an older async reveal after a newer request begins', () => {
    const gate = new TransientRevealGate()
    const first = gate.begin('secret-a:field-a')
    const second = gate.begin('secret-a:field-a')

    expect(gate.isCurrent(first, 'secret-a:field-a')).toBe(false)
    expect(gate.isCurrent(second, 'secret-a:field-a')).toBe(true)
  })

  it('cannot reuse a reveal across secret or field identity changes', () => {
    const gate = new TransientRevealGate()
    const attempt = gate.begin('secret-a:field-a')

    expect(gate.isCurrent(attempt, 'secret-b:field-a')).toBe(false)
    expect(gate.isCurrent(attempt, 'secret-a:field-b')).toBe(false)
    gate.invalidate()
    expect(gate.isCurrent(attempt, 'secret-a:field-a')).toBe(false)
  })

  it('masks the current value and cancels its timer before a reveal is re-armed', () => {
    vi.useFakeTimers()
    let visibleValue: string | null = 'old plaintext'
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = {
      current: setTimeout(() => {
        visibleValue = 'old timer fired'
      }, TRANSIENT_REVEAL_TTL_MS),
    }

    maskTransientReveal(timerRef, () => {
      visibleValue = null
    })

    expect(visibleValue).toBeNull()
    expect(timerRef.current).toBeNull()
    vi.advanceTimersByTime(TRANSIENT_REVEAL_TTL_MS)
    expect(visibleValue).toBeNull()
  })
})
