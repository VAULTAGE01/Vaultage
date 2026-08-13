import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleMainLayoutShortcut,
  ui2026SurfaceForMode,
} from './mainLayoutEffects'

const lock = vi.fn()
const preventDefault = vi.fn()
const switchSurface = vi.fn()
const toggleSearch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('__VAULTAGE_OPEN_CORE__', false)
  lock.mockReset()
  preventDefault.mockReset()
  switchSurface.mockReset()
  toggleSearch.mockReset()
})

describe('main layout effects', () => {
  it('maps each product mode to its UI2026 surface', () => {
    expect(ui2026SurfaceForMode('local')).toBe('vault')
    expect(ui2026SurfaceForMode('agent')).toBe('projects')
    expect(ui2026SurfaceForMode('integrations')).toBe('services')
  })

  it('preserves search, lock, and product-surface keyboard shortcuts', () => {
    const actions = { lock, switchSurface, toggleSearch }

    handleMainLayoutShortcut(shortcut('k'), actions)
    handleMainLayoutShortcut(shortcut('l'), actions)
    handleMainLayoutShortcut(shortcut('1'), actions)
    handleMainLayoutShortcut(shortcut('2'), actions)
    handleMainLayoutShortcut(shortcut('3'), actions)

    expect(toggleSearch).toHaveBeenCalledOnce()
    expect(lock).toHaveBeenCalledOnce()
    expect(switchSurface.mock.calls).toEqual([
      ['vault'],
      ['projects'],
      ['services'],
    ])
    expect(preventDefault).toHaveBeenCalledTimes(5)
  })
})

function shortcut(key: string) {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: true,
    preventDefault,
    shiftKey: false,
  }
}
