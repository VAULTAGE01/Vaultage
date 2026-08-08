import type { RecoveryKitMaterial } from './recoveryKit'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842

export function buildRecoveryKitPdf(material: RecoveryKitMaterial): Buffer {
  validateMaterial(material)
  const commands = [
    'q',
    '0.02 0.05 0.04 rg',
    `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`,
    '0.00 1.00 0.50 rg',
    '0 812 595 30 re f',
    'Q',
    text('F1', 24, 54, 760, 'Vaultage Emergency Kit', '1 1 1 rg'),
    text('F1', 12, 54, 735, 'Offline recovery for your local vault', '0.72 0.78 0.75 rg'),
    text('F2', 10, 466, 764, 'KEEP PRIVATE', '0.00 1.00 0.50 rg'),
    'q',
    '0.07 0.11 0.09 rg',
    '0.20 0.32 0.26 RG',
    '1 w',
    '54 620 487 92 re B',
    'Q',
    text('F1', 9, 72, 688, 'RECOVERY CODE', '0.00 1.00 0.50 rg'),
    // A canonical 58-character code fits inside the 469-point content width
    // at 12-point Courier-Bold without clipping on A4 renderers.
    text('F2', 12, 72, 657, material.recoveryCode, '1 1 1 rg'),
    text('F1', 9, 72, 633, `Vault fingerprint: ${material.vaultFingerprint}`, '0.72 0.78 0.75 rg'),
    text('F1', 13, 54, 575, 'What this kit does', '1 1 1 rg'),
    text('F1', 10, 54, 552, 'This code unwraps the key to this exact local vault so you can choose a new', '0.82 0.86 0.84 rg'),
    text('F1', 10, 54, 536, 'master password. It does not sign in to a Vaultage account or contact a server.', '0.82 0.86 0.84 rg'),
    text('F1', 13, 54, 490, 'How to recover', '1 1 1 rg'),
    text('F2', 10, 54, 465, '1.', '0.00 1.00 0.50 rg'),
    text('F1', 10, 76, 465, 'Open Vaultage and choose Use Emergency Kit.', '0.82 0.86 0.84 rg'),
    text('F2', 10, 54, 443, '2.', '0.00 1.00 0.50 rg'),
    text('F1', 10, 76, 443, 'Enter the recovery code and choose a new master password.', '0.82 0.86 0.84 rg'),
    text('F2', 10, 54, 421, '3.', '0.00 1.00 0.50 rg'),
    text('F1', 10, 76, 421, 'Save and verify the replacement Emergency Kit. The used code is revoked.', '0.82 0.86 0.84 rg'),
    'q',
    '0.10 0.08 0.03 rg',
    '0.42 0.30 0.08 RG',
    '1 w',
    '54 244 487 126 re B',
    'Q',
    text('F1', 12, 72, 340, 'Store it away from this Mac', '1 0.82 0.30 rg'),
    text('F1', 10, 72, 315, 'Print it or save it to offline storage you control. Do not email it, paste it into', '0.92 0.86 0.68 rg'),
    text('F1', 10, 72, 299, 'chat, or keep the only copy beside the vault files it protects.', '0.92 0.86 0.68 rg'),
    text('F1', 10, 72, 274, 'Anyone with this kit and your encrypted vault files can reset the master password.', '0.92 0.86 0.68 rg'),
    text('F1', 9, 54, 190, 'Vaultage has no copy of this recovery code and cannot recreate it.', '0.72 0.78 0.75 rg'),
    text('F1', 9, 54, 174, 'This PDF contains no master password, account token, provider credential, or vault plaintext.', '0.72 0.78 0.75 rg'),
    text('F1', 8, 54, 112, `Kit version: 1    Generation: ${material.generation}`, '0.48 0.55 0.51 rg'),
    text('F1', 8, 54, 98, `Created: ${material.createdAt}`, '0.48 0.55 0.51 rg'),
    text('F2', 8, 54, 64, 'vaultage.dev', '0.00 1.00 0.50 rg'),
  ].join('\n')

  return assemblePdf(commands)
}

function text(font: 'F1' | 'F2', size: number, x: number, y: number, value: string, color: string): string {
  return `BT\n${color}\n/${font} ${size} Tf\n1 0 0 1 ${x} ${y} Tm\n(${escapePdfText(value)}) Tj\nET`
}

function escapePdfText(value: string): string {
  if (!/^[\x20-\x7e]+$/u.test(value)) throw new Error('Emergency Kit PDF text must be printable ASCII')
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function assemblePdf(content: string): Buffer {
  const contentBytes = Buffer.from(content, 'ascii')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
  ]
  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')]
  const offsets = [0]
  let offset = chunks[0].length
  objects.forEach((object, index) => {
    offsets.push(offset)
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'binary')
    chunks.push(chunk)
    offset += chunk.length
  })
  const xrefOffset = offset
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join('\n')
  chunks.push(Buffer.from(xref, 'ascii'))
  return Buffer.concat(chunks)
}

function validateMaterial(material: RecoveryKitMaterial): void {
  if (material.format !== 'vaultage.recovery-kit.v1') throw new Error('Invalid Emergency Kit format')
  if (!/^VLT1-[0-9A-HJKMNPQRSTVWXYZ-]{40,80}$/u.test(material.recoveryCode)) {
    throw new Error('Invalid Emergency Kit recovery code')
  }
  if (!/^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/u.test(material.vaultFingerprint)) {
    throw new Error('Invalid Emergency Kit vault fingerprint')
  }
  if (!/^[A-Za-z0-9-]{1,80}$/u.test(material.generation)) throw new Error('Invalid Emergency Kit generation')
  if (!Number.isFinite(Date.parse(material.createdAt))) throw new Error('Invalid Emergency Kit creation time')
}
