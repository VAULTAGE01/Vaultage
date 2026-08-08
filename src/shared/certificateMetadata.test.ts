import { describe, expect, it } from 'vitest'
import {
  CertificateProjectionError,
  CERTIFICATE_EXPIRY_REMINDER_DAYS,
  projectCertificateExpiry,
} from './certificateMetadata'
import { VaultValidationError, validateVaultRoot } from './vaultValidation'
import { vaultIpcContracts } from './vaultIpcContracts'

const NOT_BEFORE = '2026-07-01T00:00:00.000Z'
const NOT_AFTER = '2027-07-01T00:00:00.000Z'

describe('certificate metadata vault boundary', () => {
  it('accepts bounded first-class certificate metadata while preserving unrelated future metadata', () => {
    const vault = certificateVault()

    expect(() => validateVaultRoot(vault)).not.toThrow()
    expect(vault.root.secrets[0].futureCertificateContext).toEqual({ enrollment: 'manual' })
  })

  it('accepts format-only metadata before optional identity details are enriched', () => {
    const vault = certificateVault()
    const metadata = vault.root.secrets[0].certificate
    for (const key of Object.keys(metadata)) {
      if (key !== 'format') Reflect.deleteProperty(metadata, key)
    }

    expect(() => validateVaultRoot(vault)).not.toThrow()
  })

  it.each([
    ['format', 'JKS', 'enum'],
    ['serialNumber', 'serial number with spaces', 'format'],
    ['notBefore', '2026-13-01T00:00:00.000Z', 'format'],
    ['sha256Fingerprint', 'AA:BB', 'format'],
  ] as const)('rejects malformed %s without reflecting its value', (field, value, code) => {
    const vault = certificateVault()
    Object.assign(vault.root.secrets[0].certificate, { [field]: value })

    const error = captureValidationError(vault)

    expect(error.code).toBe(code)
    expect(error.path).toBe(`$.root.secrets[0].certificate.${field}`)
    expect(error.message).not.toContain(value)
  })

  it('rejects an end time that does not follow the start time', () => {
    const vault = certificateVault()
    vault.root.secrets[0].certificate.notAfter = NOT_BEFORE

    const error = captureValidationError(vault)

    expect(error.code).toBe('range')
    expect(error.path).toBe('$.root.secrets[0].certificate.notAfter')
  })

  it('rejects a partial validity window', () => {
    const vault = certificateVault()
    Reflect.deleteProperty(vault.root.secrets[0].certificate, 'notAfter')

    const error = captureValidationError(vault)

    expect(error.code).toBe('required')
    expect(error.path).toBe('$.root.secrets[0].certificate.notAfter')
  })

  it('rejects private material embedded in renderer-visible certificate metadata', () => {
    const vault = certificateVault()
    Object.assign(vault.root.secrets[0].certificate, { privateKey: 'must-remain-in-sensitive-fields' })

    const error = captureValidationError(vault)

    expect(error.code).toBe('unsupported_property')
    expect(error.path).toBe('$.root.secrets[0].certificate.privateKey')
    expect(error.message).not.toContain('must-remain-in-sensitive-fields')
  })

  it('requires metadata for certificate secrets', () => {
    const vault = certificateVault()
    Reflect.deleteProperty(vault.root.secrets[0], 'certificate')

    const error = captureValidationError(vault)

    expect(error.code).toBe('required')
    expect(error.path).toBe('$.root.secrets[0].certificate')
  })

  it('rejects certificate metadata attached to another secret type', () => {
    const vault = certificateVault()
    vault.root.secrets[0].type = 'password'

    const error = captureValidationError(vault)

    expect(error.code).toBe('type_mismatch')
    expect(error.path).toBe('$.root.secrets[0].certificate')
  })
})

describe('certificate metadata mutation boundary', () => {
  it('admits certificate metadata through the semantic secret mutation contract', () => {
    const secret = certificateMutationSecret()

    const payload = vaultIpcContracts.mutate.validate({
      mutationId: 'certificate-mutation-1',
      expectedRevision: 1,
      command: { type: 'secret.create-many', folderId: 'root', secrets: [secret] },
    })

    expect(payload.command).toMatchObject({
      type: 'secret.create-many',
      secrets: [{ id: 'certificate-1', certificate: certificateMetadata() }],
    })
  })

  it('denies private material in metadata before the semantic mutation runs', () => {
    const secret = certificateMutationSecret()
    Object.assign(secret.certificate, { privateKey: 'must-remain-in-sensitive-fields' })

    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: 'certificate-mutation-2',
      expectedRevision: 1,
      command: { type: 'secret.update', folderId: 'root', secret },
    })).toThrow('unsupported property privateKey')
  })

  it('binds certificate metadata to the certificate secret type at the mutation boundary', () => {
    const missing = certificateMutationSecret()
    Reflect.deleteProperty(missing, 'certificate')
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: 'certificate-mutation-3',
      expectedRevision: 1,
      command: { type: 'secret.create-many', folderId: 'root', secrets: [missing] },
    })).toThrow('certificate is required for certificate secrets')

    const mismatched = certificateMutationSecret()
    mismatched.type = 'password'
    expect(() => vaultIpcContracts.mutate.validate({
      mutationId: 'certificate-mutation-4',
      expectedRevision: 1,
      command: { type: 'secret.create-many', folderId: 'root', secrets: [mismatched] },
    })).toThrow('certificate is supported only for certificate secrets')
  })
})

describe('projectCertificateExpiry', () => {
  it('projects a fixed reminder window without changing stored metadata', () => {
    const certificate = certificateMetadata()
    const nowMs = Date.parse('2027-06-15T00:00:00.000Z')

    const projection = projectCertificateExpiry(certificate, nowMs)

    expect(projection).toEqual({
      status: 'expiring',
      expiresAt: NOT_AFTER,
      reminderAt: '2027-06-01T00:00:00.000Z',
      reminderDue: true,
      remainingDays: 16,
    })
    expect(CERTIFICATE_EXPIRY_REMINDER_DAYS).toBe(30)
    expect(certificate.notAfter).toBe(NOT_AFTER)
  })

  it.each([
    ['2026-06-30T23:59:59.000Z', 'not-yet-valid', false, 366],
    ['2026-07-01T00:00:00.000Z', 'valid', false, 365],
    ['2027-07-01T00:00:00.000Z', 'expired', false, 0],
  ] as const)('projects %s as %s', (now, status, reminderDue, remainingDays) => {
    expect(projectCertificateExpiry(certificateMetadata(), Date.parse(now))).toMatchObject({
      status,
      reminderDue,
      remainingDays,
    })
  })

  it('fails safely if an unvalidated caller bypasses the vault boundary', () => {
    const certificate = { ...certificateMetadata(), notAfter: 'do-not-reflect-this-invalid-time' }

    try {
      projectCertificateExpiry(certificate, Date.parse(NOT_BEFORE))
      throw new Error('expected certificate projection to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CertificateProjectionError)
      expect(String(error)).not.toContain('do-not-reflect-this-invalid-time')
    }
  })
})

function certificateVault() {
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
          { key: 'Certificate', value: '-----BEGIN CERTIFICATE-----', sensitive: true },
          { key: 'Private Key', value: 'encrypted-with-the-vault', sensitive: true },
        ],
        notes: '',
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        certificate: certificateMetadata(),
        futureCertificateContext: { enrollment: 'manual' },
      }],
      itemOrder: [{ kind: 'secret', id: 'certificate-1' }],
    },
    providers: [],
    providerGroups: [],
    envProjects: [],
  }
}

function certificateMetadata() {
  return {
    format: 'PEM' as const,
    subject: 'CN=api.example.test',
    issuer: 'CN=Example Internal CA',
    serialNumber: '01A2B3C4',
    notBefore: NOT_BEFORE,
    notAfter: NOT_AFTER,
    algorithm: 'ECDSA P-256 with SHA-256',
    sha256Fingerprint: 'a'.repeat(64),
  }
}

function certificateMutationSecret() {
  const secret = certificateVault().root.secrets[0]
  Reflect.deleteProperty(secret, 'futureCertificateContext')
  return secret
}

function captureValidationError(value: unknown): VaultValidationError {
  try {
    validateVaultRoot(value)
    throw new Error('expected certificate validation to fail')
  } catch (error) {
    if (error instanceof VaultValidationError) return error
    throw error
  }
}
