import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  CertificateImportError,
  MAX_CERTIFICATE_IMPORT_BYTES,
  parseCertificateMetadata,
} from './certificateImport'

const PEM = `-----BEGIN CERTIFICATE-----
MIIC8jCCAdoCCQDXHxy2r/MI3DANBgkqhkiG9w0BAQsFADA7MRQwEgYDVQQDDAtw
YXJzZXIudGVzdDEWMBQGA1UECgwNVmF1bHRhZ2UgVGVzdDELMAkGA1UEBhMCVVMw
HhcNMjYwODA4MTc0NjAxWhcNMjYwOTA3MTc0NjAxWjA7MRQwEgYDVQQDDAtwYXJz
ZXIudGVzdDEWMBQGA1UECgwNVmF1bHRhZ2UgVGVzdDELMAkGA1UEBhMCVVMwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC8KrZhUqFeCVF8NPnzczO4J/7h
HB+RAS6JvGp3QtrHDpxWmkVgn31lDfvXEqT3W/mRgm+FnGa3JjnBCPq9r5zLGrkj
Rnj8zH8M3iiNTa1Ndo0CzQINVujCWs/DfCn5sZbfKVhTAtsQdMr6HsRk9r19xQTe
pTTo7ITZJxdLdXIJpPheqitoYXTDhbjjlEPBlQkHC/PYIXuruwrJoDLMpPaIMiSn
suwXtgcJ1D3ThGRyST+O2QmV6Vr633/q0QeaeiIYw1QGljdj/WXLAUImKxMfwBDI
QL8vRLk440hGkE9glba8DkXgt29GYxnml9bZd+bRvoJmq8XDfFDMKRwQBY8BAgMB
AAEwDQYJKoZIhvcNAQELBQADggEBAKDPdJTBLwutSgvH8LwlxfzjIaJfNH9lU4FU
RIclw2FKlQUnV+yLWx6o51/UUM/bJs8wNTIezz2VDf9A1wyPBzRceJsVTuk53G0F
q8bBV5VW7y6ETPszohFMUp04DFdLAodNV/zDaQTTGpoEdua4N2vr4v6MW+sMV90L
doXEwHoj32EtIre5JWGGLXEap7YTikYa7FoII4VLrBqL8bRwjMjAiF8n0M8zIRuC
hdD/W5K32pSoys+jEBDAmIy1L6AjJ+yZXS4JTurEGY+N7svwP1PyzO8VSLrAYRBm
pZqqjA3REvXUYkfnAONQvLbN5FIDHNdAl/8dQYolCqfndTjPXQw=
-----END CERTIFICATE-----`

const DER = Buffer.from(
  'MIIC8jCCAdoCCQDXHxy2r/MI3DANBgkqhkiG9w0BAQsFADA7MRQwEgYDVQQDDAtwYXJzZXIudGVzdDEWMBQGA1UECgwNVmF1bHRhZ2UgVGVzdDELMAkGA1UEBhMCVVMwHhcNMjYwODA4MTc0NjAxWhcNMjYwOTA3MTc0NjAxWjA7MRQwEgYDVQQDDAtwYXJzZXIudGVzdDEWMBQGA1UECgwNVmF1bHRhZ2UgVGVzdDELMAkGA1UEBhMCVVMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC8KrZhUqFeCVF8NPnzczO4J/7hHB+RAS6JvGp3QtrHDpxWmkVgn31lDfvXEqT3W/mRgm+FnGa3JjnBCPq9r5zLGrkjRnj8zH8M3iiNTa1Ndo0CzQINVujCWs/DfCn5sZbfKVhTAtsQdMr6HsRk9r19xQTepTTo7ITZJxdLdXIJpPheqitoYXTDhbjjlEPBlQkHC/PYIXuruwrJoDLMpPaIMiSnsuwXtgcJ1D3ThGRyST+O2QmV6Vr633/q0QeaeiIYw1QGljdj/WXLAUImKxMfwBDIQL8vRLk440hGkE9glba8DkXgt29GYxnml9bZd+bRvoJmq8XDfFDMKRwQBY8BAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAKDPdJTBLwutSgvH8LwlxfzjIaJfNH9lU4FURIclw2FKlQUnV+yLWx6o51/UUM/bJs8wNTIezz2VDf9A1wyPBzRceJsVTuk53G0Fq8bBV5VW7y6ETPszohFMUp04DFdLAodNV/zDaQTTGpoEdua4N2vr4v6MW+sMV90LdoXEwHoj32EtIre5JWGGLXEap7YTikYa7FoII4VLrBqL8bRwjMjAiF8n0M8zIRuChdD/W5K32pSoys+jEBDAmIy1L6AjJ+yZXS4JTurEGY+N7svwP1PyzO8VSLrAYRBmpZqqjA3REvXUYkfnAONQvLbN5FIDHNdAl/8dQYolCqfndTjPXQw=',
  'base64',
)

describe('parseCertificateMetadata', () => {
  it('extracts bounded value-free metadata from a PEM certificate', () => {
    expect(parseCertificateMetadata('PEM', Buffer.from(PEM))).toEqual({
      format: 'PEM',
      subject: 'CN=parser.test\nO=Vaultage Test\nC=US',
      issuer: 'CN=parser.test\nO=Vaultage Test\nC=US',
      serialNumber: 'd71f1cb6aff308dc',
      notBefore: '2026-08-08T17:46:01.000Z',
      notAfter: '2026-09-07T17:46:01.000Z',
      algorithm: 'rsa',
      sha256Fingerprint: 'e6a4e31b439127da8673c06ecd557148b6b2a24fdc427e6764fd2a93dfc691c4',
    })
  })

  it('extracts the same identity metadata from DER bytes', () => {
    expect(parseCertificateMetadata('DER', DER)).toMatchObject({
      format: 'DER',
      subject: 'CN=parser.test\nO=Vaultage Test\nC=US',
      notAfter: '2026-09-07T17:46:01.000Z',
    })
  })

  it('rejects empty, oversized, PKCS #12, malformed, and chained input without returning material', () => {
    const attempts: Array<[Parameters<typeof parseCertificateMetadata>, string]> = [
      [['PEM', Buffer.alloc(0)], 'empty'],
      [['DER', Buffer.alloc(MAX_CERTIFICATE_IMPORT_BYTES + 1)], 'too_large'],
      [['PKCS12', Buffer.from('bundle')], 'unsupported_format'],
      [['PEM', Buffer.from('not a certificate')], 'invalid_certificate'],
      [['PEM', Buffer.from(`${PEM}\n${PEM}`)], 'multiple_certificates'],
    ]

    for (const [input, code] of attempts) {
      expect(() => parseCertificateMetadata(...input)).toThrow(CertificateImportError)
      try {
        parseCertificateMetadata(...input)
      } catch (error) {
        expect(error).toMatchObject({ code })
      }
    }
  })
})
