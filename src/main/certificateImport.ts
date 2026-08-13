import { X509Certificate } from 'node:crypto'
import {
  assertCertificateMetadata,
  type CertificateFormat,
  type CertificateMetadata,
} from '../shared/certificateMetadata'

/** Limits local parsing work before certificate material enters a vault field. */
export const MAX_CERTIFICATE_IMPORT_BYTES = 1_000_000

export type ParseableCertificateFormat = Extract<CertificateFormat, 'PEM' | 'DER'>

export type CertificateImportErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_format'
  | 'multiple_certificates'
  | 'invalid_certificate'

/** Value-free failure classification suitable for a renderer import form. */
export class CertificateImportError extends Error {
  readonly name = 'CertificateImportError'

  constructor(readonly code: CertificateImportErrorCode, message: string) {
    super(message)
  }
}

/**
 * Extracts bounded, value-free identity and validity metadata from one explicit
 * local PEM or DER X.509 certificate. It never returns certificate bytes,
 * private-key material, or a chain. PKCS #12 parsing needs its own authenticated
 * bundle workflow and is deliberately rejected here.
 */
export function parseCertificateMetadata(
  format: CertificateFormat,
  certificateBytes: Uint8Array,
): CertificateMetadata {
  if (certificateBytes.byteLength === 0) {
    throw new CertificateImportError('empty', 'Choose a certificate file to import.')
  }
  if (certificateBytes.byteLength > MAX_CERTIFICATE_IMPORT_BYTES) {
    throw new CertificateImportError('too_large', 'Certificate files must be 1 MB or smaller.')
  }
  if (format === 'PKCS12') {
    throw new CertificateImportError(
      'unsupported_format',
      'PKCS #12 metadata extraction is not available yet. Add its details manually or import PEM/DER.',
    )
  }

  if (format === 'PEM') assertSinglePemCertificate(certificateBytes)

  try {
    const certificate = new X509Certificate(Buffer.from(certificateBytes))
    const metadata: CertificateMetadata = {
      format,
      subject: certificate.subject || undefined,
      issuer: certificate.issuer || undefined,
      serialNumber: certificate.serialNumber.toLowerCase(),
      notBefore: new Date(certificate.validFrom).toISOString(),
      notAfter: new Date(certificate.validTo).toISOString(),
      algorithm: certificate.publicKey.asymmetricKeyType,
      sha256Fingerprint: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
    }
    assertCertificateMetadata(metadata)
    return metadata
  } catch (error) {
    if (error instanceof CertificateImportError) throw error
    throw new CertificateImportError('invalid_certificate', 'The selected file is not a valid X.509 certificate.')
  }
}

function assertSinglePemCertificate(certificateBytes: Uint8Array): void {
  const text = new TextDecoder().decode(certificateBytes)
  const certificates = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu) ?? []
  if (certificates.length > 1) {
    throw new CertificateImportError('multiple_certificates', 'Import one certificate at a time, not a certificate chain.')
  }
  if (certificates.length !== 1 || text.replace(certificates[0]!, '').trim() !== '') {
    throw new CertificateImportError('invalid_certificate', 'The selected PEM file must contain one X.509 certificate.')
  }
}
