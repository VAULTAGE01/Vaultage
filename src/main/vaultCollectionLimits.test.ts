import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatVaultAttachmentRef, parseVaultAttachmentRef } from '../shared/vaultAttachments'
import { measureVaultAttachmentBlobBytes } from './vaultCollectionLimits'

let testDirectory: string | null = null

afterEach(async () => {
  if (testDirectory) await fs.rm(testDirectory, { recursive: true, force: true })
  testDirectory = null
})

describe('vault collection attachment limits', () => {
  it('accepts the exact referenced union and rejects its aggregate overflow', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'vaultage-collection-limits-'))
    testDirectory = directory
    const references = new Map([
      attachmentReference('a'.repeat(64)),
      attachmentReference('b'.repeat(64)),
    ])
    await Promise.all([...references.keys()].map(id => (
      fs.writeFile(join(directory, `${id}.blob`), Buffer.alloc(40, 1))
    )))

    await expect(measureVaultAttachmentBlobBytes(directory, references, {
      maxCount: 2,
      maxAggregateBytes: 80,
    }))
      .resolves.toBe(80)
    await expect(measureVaultAttachmentBlobBytes(directory, references, {
      maxCount: 2,
      maxAggregateBytes: 79,
    }))
      .rejects.toThrow('aggregate byte limit')
  })
})

function attachmentReference(id: string) {
  const reference = parseVaultAttachmentRef(formatVaultAttachmentRef(id, 'image/png'))
  return [id, reference] as const
}
