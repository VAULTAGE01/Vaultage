import { describe, expect, it } from 'vitest'
import { RENDERER_CSP } from './contentSecurityPolicy'

describe('renderer content security policy', () => {
  it('keeps renderer network egress constrained', () => {
    expect(RENDERER_CSP).toContain("connect-src 'self'")
    expect(RENDERER_CSP).toContain("object-src 'none'")
    expect(RENDERER_CSP).toContain("base-uri 'self'")
    expect(RENDERER_CSP).toContain("frame-ancestors 'none'")
    expect(RENDERER_CSP).not.toContain('connect-src https:')
    expect(RENDERER_CSP).not.toContain('connect-src *')
  })
})
