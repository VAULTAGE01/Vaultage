import type { Session } from 'electron'

const BASE_RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
]

export const RENDERER_CSP = [
  ...BASE_RENDERER_CSP,
  "connect-src 'self'",
].join('; ')

export const DEVELOPMENT_RENDERER_CSP = [
  ...BASE_RENDERER_CSP,
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
].join('; ')

export function installRendererCsp(
  targetSession: Session,
  options: { allowDevelopmentWebSockets?: boolean } = {},
): void {
  const policy = options.allowDevelopmentWebSockets ? DEVELOPMENT_RENDERER_CSP : RENDERER_CSP
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}
