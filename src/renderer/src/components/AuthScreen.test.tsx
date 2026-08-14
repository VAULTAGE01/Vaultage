import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../vaultContext', () => ({
  useVault: () => ({
    state: { error: null },
    unlockPassword: vi.fn(),
    unlockTouchID: vi.fn(),
  }),
}))

import AuthScreen from './AuthScreen'

describe('AuthScreen', () => {
  it('restores the UI2026 login surface without the legacy liquid card', () => {
    const html = renderToStaticMarkup(<AuthScreen />)

    expect(html).toContain('ui26-auth-shell')
    expect(html).toContain('ui26-auth-panel')
    expect(html).toContain('ui26-auth-primary')
    expect(html).not.toContain('liquid-shell')
    expect(html).not.toContain('liquid-card')
  })
})
