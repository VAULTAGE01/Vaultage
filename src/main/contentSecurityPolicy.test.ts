import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_RENDERER_CSP, RENDERER_CSP } from './contentSecurityPolicy'

describe('renderer content security policy', () => {
  it('keeps renderer network egress constrained', () => {
    expect(RENDERER_CSP).toContain("connect-src 'self'")
    expect(RENDERER_CSP).toContain("object-src 'none'")
    expect(RENDERER_CSP).toContain("base-uri 'self'")
    expect(RENDERER_CSP).toContain("frame-ancestors 'none'")
    expect(RENDERER_CSP).not.toContain('connect-src https:')
    expect(RENDERER_CSP).not.toContain('connect-src *')
    expect(RENDERER_CSP).not.toContain('ws://')
  })

  it('allows loopback web sockets only in the explicit development policy', () => {
    expect(DEVELOPMENT_RENDERER_CSP).toContain('ws://localhost:*')
    expect(DEVELOPMENT_RENDERER_CSP).toContain('ws://127.0.0.1:*')
    expect(DEVELOPMENT_RENDERER_CSP).not.toContain('ws://[::1]:*')
    expect(readFileSync(resolve('src/renderer/index.html'), 'utf8')).not.toContain('ws://[::1]:*')
  })
})
