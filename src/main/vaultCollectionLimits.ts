import { constants as fsConstants, promises as fs } from 'fs'
import { join } from 'path'
import {
  VAULT_ATTACHMENT_ENVELOPE_BYTES,
  VAULT_ATTACHMENT_LIMITS,
  type VaultAttachmentReference,
} from '../shared/vaultAttachments'
import { VAULT_ATTACHMENT_FILE_EXTENSION } from './vaultAttachmentStore'

export const MAX_VAULT_COLLECTION_ATTACHMENTS = VAULT_ATTACHMENT_LIMITS.maxCount
export const MAX_VAULT_COLLECTION_ATTACHMENT_BYTES = 256 * 1024 * 1024

export type VaultCollectionAttachmentLimits = {
  readonly maxCount: number
  readonly maxAggregateBytes: number
}

export class VaultCollectionLimitError extends Error {
  readonly name = 'VaultCollectionLimitError'
}

export async function measureVaultAttachmentBlobBytes(
  directory: string,
  references: ReadonlyMap<string, VaultAttachmentReference>,
  limits: VaultCollectionAttachmentLimits,
): Promise<number> {
  if (references.size > limits.maxCount) {
    throw new VaultCollectionLimitError('Vault collection contains too many attachments')
  }

  let aggregateBytes = 0
  for (const [id, reference] of references) {
    if (id !== reference.id) {
      throw new VaultCollectionLimitError('Vault collection attachment identity is inconsistent')
    }
    let handle: fs.FileHandle | null = null
    try {
      const path = join(directory, `${id}${VAULT_ATTACHMENT_FILE_EXTENSION}`)
      const before = await fs.lstat(path)
      if (!before.isFile() || before.isSymbolicLink()) {
        throw new VaultCollectionLimitError('Vault collection attachment must be a regular file')
      }
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      handle = await fs.open(path, fsConstants.O_RDONLY | noFollow)
      const current = await handle.stat()
      if (
        !current.isFile()
        || current.dev !== before.dev
        || current.ino !== before.ino
        || current.size <= VAULT_ATTACHMENT_ENVELOPE_BYTES
        || current.size > VAULT_ATTACHMENT_LIMITS.maxEncryptedBlobBytes
      ) {
        throw new VaultCollectionLimitError('Vault collection attachment is invalid')
      }
      aggregateBytes += current.size
      if (aggregateBytes > limits.maxAggregateBytes) {
        throw new VaultCollectionLimitError('Vault collection attachments exceed the aggregate byte limit')
      }
    } finally {
      await handle?.close()
    }
  }
  return aggregateBytes
}
