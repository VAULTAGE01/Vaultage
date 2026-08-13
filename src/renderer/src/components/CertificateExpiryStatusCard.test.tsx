import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CertificateExpiryStatusCard } from './CertificateExpiryStatusCard'

describe('CertificateExpiryStatusCard', () => {
  it('renders an actionable expiry warning without certificate material', () => {
    const html = renderToStaticMarkup(
      <CertificateExpiryStatusCard
        certificate={{
          format: 'PEM',
          subject: 'CN=example.test',
          notBefore: '2026-07-01T00:00:00.000Z',
          notAfter: '2026-08-20T00:00:00.000Z',
        }}
        nowMs={Date.parse('2026-08-08T00:00:00.000Z')}
      />,
    )

    expect(html).toContain('Expires in 12 days')
    expect(html).toContain('Review or rotate this certificate before it expires.')
    expect(html).not.toContain('private-key')
  })

  it.each([
    ['2026-07-31T00:00:00.000Z', 'Certificate not active'],
    ['2026-08-01T00:00:00.000Z', 'Certificate valid'],
    ['2026-08-15T00:00:00.000Z', 'Expires in 17 days'],
    ['2026-09-01T00:00:00.000Z', 'Certificate expired'],
  ])('projects %s as %s', (now, expectedStatus) => {
    const html = renderToStaticMarkup(
      <CertificateExpiryStatusCard
        certificate={{
          format: 'PEM',
          notBefore: '2026-08-01T00:00:00.000Z',
          notAfter: '2026-09-01T00:00:00.000Z',
        }}
        nowMs={Date.parse(now)}
      />,
    )

    expect(html).toContain(expectedStatus)
  })
})
