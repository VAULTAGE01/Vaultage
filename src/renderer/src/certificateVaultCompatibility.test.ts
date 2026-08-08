import { describe, expect, it } from 'vitest'
import {
  CERTIFICATE_FORMATS,
  type CertificateFormat,
} from '../../shared/certificateMetadata'
import { serializeScopedVaultExportJson } from '../../shared/vaultExport'
import { parseVaultJson } from './vaultFormat'

describe('certificate vault format compatibility', () => {
  it.each(CERTIFICATE_FORMATS)('round-trips %s metadata without a vault migration', format => {
    const vault = certificateVault(format)

    const parsed = parseVaultJson(JSON.stringify(vault))

    expect(parsed.version).toBe(2)
    expect(parsed.root.secrets[0]?.certificate).toEqual(vault.root.secrets[0].certificate)
    expect(parsed.root.secrets[0]?.fields).toEqual(vault.root.secrets[0].fields)
    expect(parsed.root.secrets[0]?.providerLink).toEqual(vault.root.secrets[0].providerLink)
  })

  it('preserves certificate metadata and private fields in an explicit scoped JSON export', () => {
    const vault = certificateVault('PEM')
    const exported = serializeScopedVaultExportJson(
      vault,
      { kind: 'secret', id: 'certificate-1' },
      '2026-08-06T00:00:00.000Z',
    )

    const imported = parseVaultJson(exported.content)
    const secret = imported.root.secrets[0]

    expect(secret?.certificate).toEqual(vault.root.secrets[0].certificate)
    expect(secret?.fields.find(field => field.key === 'Private Key')?.value).toBe('private-key-material')
    expect(secret?.providerLink).toBeUndefined()
  })

  it('continues to accept an older vault that has no certificate records', () => {
    const vault = certificateVault('DER')
    vault.version = 1
    vault.root.secrets = []
    vault.root.itemOrder = []

    const parsed = parseVaultJson(JSON.stringify(vault))

    expect(parsed.version).toBe(1)
    expect(parsed.root.secrets).toEqual([])
  })
})

function certificateVault(format: CertificateFormat) {
  return {
    version: 2,
    revision: 1,
    root: {
      id: 'root',
      name: 'Vault',
      children: [],
      secrets: [{
        id: 'certificate-1',
        name: 'API client certificate',
        type: 'certificate',
        fields: [
          { key: 'Certificate', value: 'certificate-material', sensitive: true },
          { key: 'Private Key', value: 'private-key-material', sensitive: true },
        ],
        notes: '',
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        certificate: {
          format,
          subject: 'CN=api.example.test',
          issuer: 'CN=Example Internal CA',
          serialNumber: '01A2B3C4',
          notBefore: '2026-07-01T00:00:00.000Z',
          notAfter: '2027-07-01T00:00:00.000Z',
          algorithm: 'ECDSA P-256 with SHA-256',
          sha256Fingerprint: 'a'.repeat(64),
        },
        providerLink: {
          providerId: 'provider-1',
          remoteName: 'client-certificate',
          createdInVaultage: false,
        },
      }],
      itemOrder: [{ kind: 'secret', id: 'certificate-1' }],
    },
    providers: [{
      id: 'provider-1',
      name: 'Certificate Provider',
      type: 'custom',
      config: {},
    }],
    providerGroups: [],
    envProjects: [],
  }
}
