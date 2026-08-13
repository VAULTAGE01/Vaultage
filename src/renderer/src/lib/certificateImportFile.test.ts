import { describe, expect, it } from 'vitest'
import { readCertificateImportFile } from './certificateImportFile'

describe('readCertificateImportFile', () => {
  it('preserves one selected PEM as sensitive field text while sending canonical base64 for local metadata preview', async () => {
    const certificate = '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----'
    const selected = new File([certificate], 'client.crt', { type: 'application/x-pem-file' })

    const result = await readCertificateImportFile(selected)

    expect(result).toEqual({
      fileName: 'client.crt',
      format: 'PEM',
      certificateBase64: btoa(certificate),
      storedValue: certificate,
    })
  })

  it('preserves a selected DER certificate as base64 field text', async () => {
    const selected = new File([Uint8Array.from([0x30, 0x82, 0x01, 0x01])], 'client.der')

    const result = await readCertificateImportFile(selected)

    expect(result).toMatchObject({
      fileName: 'client.der',
      format: 'DER',
      certificateBase64: 'MIIBAQ==',
      storedValue: 'MIIBAQ==',
    })
  })
})
