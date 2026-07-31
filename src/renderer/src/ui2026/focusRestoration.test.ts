import { describe, expect, it, vi } from 'vitest'
import { scheduleElementFocus } from './focusRestoration'

describe('UI2026 focus restoration', () => {
  it('focuses a target after the remount frame', () => {
    const frames: FrameRequestCallback[] = []
    const focus = vi.fn()
    const frame = scheduleElementFocus(
      'projects-search',
      (callback) => {
        frames.push(callback)
        return 17
      },
      (id) => id === 'projects-search' ? { focus } : null,
    )

    expect(frame).toBe(17)
    expect(focus).not.toHaveBeenCalled()
    frames[0]?.(0)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('does not fail when the target was replaced before the frame', () => {
    const frames: FrameRequestCallback[] = []
    const frame = scheduleElementFocus(
      'missing',
      (callback) => {
        frames.push(callback)
        return 18
      },
      () => null,
    )

    expect(frame).toBe(18)
    expect(() => frames[0]?.(0)).not.toThrow()
  })
})
