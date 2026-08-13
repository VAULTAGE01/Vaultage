import type { CertificateFormat } from '../../../shared/certificateMetadata'

const MAX_CERTIFICATE_IMPORT_BYTES = 1_000_000
const BASE64_CHUNK_BYTES = 16_384

export interface CertificateImportFile {
  readonly fileName: string
  readonly format: CertificateFormat
  readonly certificateBase64: string
  readonly storedValue: string
}

/** Reads a user-selected certificate once, bounded before it reaches the IPC boundary. */
export async function readCertificateImportFile(file: File): Promise<CertificateImportFile> {
  if (file.size === 0) throw new Error('Choose a certificate file to import.')
  if (file.size > MAX_CERTIFICATE_IMPORT_BYTES) throw new Error('Certificate files must be 1 MB or smaller.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const certificateBase64 = bytesToBase64(bytes)
  const format = certificateFormatForFile(file.name, bytes)
  return {
    fileName: file.name || 'certificate',
    format,
    certificateBase64,
    storedValue: format === 'PEM' ? new TextDecoder().decode(bytes) : certificateBase64,
  }
}

function certificateFormatForFile(fileName: string, bytes: Uint8Array): CertificateFormat {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.p12') || lowerName.endsWith('.pfx')) return 'PKCS12'
  const leadingText = new TextDecoder().decode(bytes.subarray(0, 64))
  return leadingText.includes('-----BEGIN CERTIFICATE-----') ? 'PEM' : 'DER'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}
