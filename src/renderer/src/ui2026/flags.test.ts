import { describe, expect, it } from 'vitest'
import { isUi2026Enabled, parseUi2026Flags } from './flags'

describe('UI 2026 build flags', () => {
  it('fails closed by default and for malformed inputs', () => {
    expect(parseUi2026Flags(undefined)).toEqual({ vault: false, projects: false, services: false })
    expect(parseUi2026Flags({ vault: 'true', projects: 1, services: null })).toEqual({ vault: false, projects: false, services: false })
  })

  it('enables each surface independently', () => {
    const flags = parseUi2026Flags({ vault: true, projects: false, services: true })
    expect(isUi2026Enabled('vault', flags)).toBe(true)
    expect(isUi2026Enabled('projects', flags)).toBe(false)
    expect(isUi2026Enabled('services', flags)).toBe(true)
  })
})
