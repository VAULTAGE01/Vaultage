import { describe, expect, it } from 'vitest'
import { REDACTED_SECRET_VALUE } from '../shared/vaultRedaction'
import { redactVaultForRenderer } from './vaultRedaction'

describe('certificate renderer redaction', () => {
  it('keeps value-free metadata visible while redacting certificate and key material', () => {
    const certificate = {
      format: 'PEM',
      subject: 'CN=api.example.test',
      issuer: 'CN=Example Internal CA',
      serialNumber: '01A2B3C4',
      notBefore: '2026-07-01T00:00:00.000Z',
      notAfter: '2027-07-01T00:00:00.000Z',
      algorithm: 'ECDSA P-256 with SHA-256',
      sha256Fingerprint: 'a'.repeat(64),
    }
    const redacted = redactVaultForRenderer({
      root: {
        children: [],
        secrets: [{
          id: 'certificate-1',
          type: 'certificate',
          certificate,
          fields: [
            { key: 'Certificate', value: 'certificate-material', sensitive: true },
            { key: 'Private Key', value: 'private-key-material', sensitive: true },
          ],
        }],
      },
      providers: [],
    })

    expect(redacted).toMatchObject({
      root: {
        secrets: [{
          certificate,
          fields: [
            { value: REDACTED_SECRET_VALUE },
            { value: REDACTED_SECRET_VALUE },
          ],
        }],
      },
    })
    expect(JSON.stringify(redacted)).not.toContain('private-key-material')
  })
})
