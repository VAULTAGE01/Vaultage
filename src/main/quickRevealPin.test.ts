import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createQuickRevealPinRecord,
  configureQuickRevealPinThrottleStore,
  hasQuickRevealPin,
  optionalQuickRevealPin,
  requireQuickRevealPin,
  resetQuickRevealPinThrottle,
} from './quickRevealPin'

afterEach(() => {
  configureQuickRevealPinThrottleStore(null)
  resetQuickRevealPinThrottle()
})

describe('quick reveal PIN helpers', () => {
  it('verifies a configured reveal PIN without exposing the verifier', async () => {
    const vault = {
      preferences: {
        quickRevealPin: await createQuickRevealPinRecord('123456'),
      },
    }

    expect(hasQuickRevealPin(vault)).toBe(true)
    await expect(requireQuickRevealPin(vault, '123456')).resolves.toBeUndefined()
    await expect(requireQuickRevealPin(vault, '000000')).rejects.toThrow('Incorrect PIN')
    expect(JSON.stringify(vault)).not.toContain('123456')
    resetQuickRevealPinThrottle()
  })

  it('validates optional PIN input at the IPC boundary', () => {
    expect(optionalQuickRevealPin(undefined)).toBeUndefined()
    expect(optionalQuickRevealPin('')).toBeUndefined()
    expect(optionalQuickRevealPin('987654')).toBe('987654')
    expect(optionalQuickRevealPin('9876')).toBe('9876')
    expect(() => optionalQuickRevealPin('98x6')).toThrow('PIN')
  })

  it('rejects parallel PIN checks instead of running unbounded scrypt work', async () => {
    const vault = {
      preferences: {
        quickRevealPin: await createQuickRevealPinRecord('123456'),
      },
    }

    const first = requireQuickRevealPin(vault, '000000')
    await expect(requireQuickRevealPin(vault, '000000')).rejects.toThrow('already in progress')
    await expect(first).rejects.toThrow('Incorrect PIN')
    resetQuickRevealPinThrottle()
  })

  it('honors a persisted retry ceiling across process memory resets', async () => {
    const vault = { preferences: { quickRevealPin: await createQuickRevealPinRecord('123456') } }
    const store = {
      load: vi.fn().mockResolvedValue({
        failures: 10,
        blockedUntil: Number.MAX_SAFE_INTEGER,
        lastTouched: Date.now(),
      }),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined),
    }
    configureQuickRevealPinThrottleStore(store)

    await expect(requireQuickRevealPin(vault, '123456')).rejects.toThrow('disabled after too many attempts')
    expect(store.load).toHaveBeenCalledOnce()
  })

  it('fails closed when persisted throttle state cannot be read', async () => {
    const vault = { preferences: { quickRevealPin: await createQuickRevealPinRecord('123456') } }
    configureQuickRevealPinThrottleStore({
      load: vi.fn().mockRejectedValue(new Error('permission denied')),
      save: vi.fn(),
      clear: vi.fn(),
      clearAll: vi.fn().mockResolvedValue(undefined),
    })

    await expect(requireQuickRevealPin(vault, '123456')).rejects.toThrow('persistence is unavailable')
    await expect(requireQuickRevealPin(vault, '123456')).rejects.toThrow('persistence is unavailable')
  })

  it('disables further PIN attempts when a failed attempt cannot be persisted', async () => {
    const vault = { preferences: { quickRevealPin: await createQuickRevealPinRecord('123456') } }
    configureQuickRevealPinThrottleStore({
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockRejectedValue(new Error('disk full')),
      clear: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined),
    })

    await expect(requireQuickRevealPin(vault, '000000')).rejects.toThrow('Incorrect PIN')
    await expect(requireQuickRevealPin(vault, '123456')).rejects.toThrow('persistence is unavailable')
  })

  it('rejects hostile KDF metadata before starting expensive PIN work', async () => {
    const record = await createQuickRevealPinRecord('123456')
    const vault = {
      preferences: {
        quickRevealPin: {
          ...record,
          scrypt: { ...record.scrypt, N: record.scrypt.N * 8 },
        },
      },
    }

    await expect(requireQuickRevealPin(vault, '123456')).rejects.toThrow('verifier is invalid')
  })
})
