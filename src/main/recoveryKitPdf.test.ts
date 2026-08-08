import { describe, expect, it } from 'vitest'
import { buildRecoveryKitPdf } from './recoveryKitPdf'

const MATERIAL = {
  format: 'vaultage.recovery-kit.v1' as const,
  generation: 'generation-123',
  createdAt: '2026-08-02T12:00:00.000Z',
  vaultFingerprint: '1234-5678-90AB-CDEF',
  recoveryCode: 'VLT1-04106-1050R-3GG28-A1C60-T3GF2-08H44-RM2MB-1E673-KJ75Y',
}

describe('Emergency Kit PDF', () => {
  it('builds a bounded one-page PDF containing only the intended recovery material', () => {
    const pdf = buildRecoveryKitPdf(MATERIAL)
    const raw = pdf.toString('binary')

    expect(raw.startsWith('%PDF-1.7')).toBe(true)
    expect(raw).toContain('/Count 1')
    expect(raw).toContain(MATERIAL.recoveryCode)
    expect(raw).toContain('/F2 12 Tf')
    expect(raw).toContain(MATERIAL.vaultFingerprint)
    expect(raw).toContain('Vaultage has no copy')
    expect(raw).not.toContain('master password:')
    expect(raw).not.toContain('provider credential:')
    expect(pdf.byteLength).toBeLessThan(32 * 1024)

    const xrefOffset = Number(/startxref\n(\d+)\n%%EOF/u.exec(raw)?.[1])
    expect(raw.slice(xrefOffset, xrefOffset + 4)).toBe('xref')
  })
})
