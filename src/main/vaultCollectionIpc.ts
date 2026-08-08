import type { IpcMain } from 'electron'
import { createHash } from 'crypto'
import {
  createVault,
  deleteVault,
  readVaultById,
  readVaultCollection,
  renameVault,
  setVaultArchived,
  switchActiveVault,
  StaleVaultCollectionMutationError,
  type VaultCollectionMutationRequest,
} from './vaultStorage'
import { redactVaultForRenderer } from './vaultRedaction'
import { vaultRevisionFrom, type VaultIpcDeps } from './vaultIpcCommon'
import { vaultIpcContracts } from '../shared/vaultIpcContracts'

export function registerVaultCollectionIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  const contracts = vaultIpcContracts

  ipcMain.handle(contracts.listVaults.channel, async (_, rawPayload: unknown) => {
    try {
      contracts.listVaults.validate(rawPayload)
      const key = deps.getVaultKey()
      if (!key) return { success: false, error: 'Not authenticated' }
      return { success: true, collection: await readVaultCollection(key) }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(contracts.createVault.channel, async (_, rawPayload: unknown) => {
    let operation: ReturnType<VaultIpcDeps['beginSessionOperation']> = null
    try {
      const payload = contracts.createVault.validate(rawPayload)
      await deps.beforeVaultScopeChange?.()
      operation = deps.beginSessionOperation()
      const key = deps.getVaultKey()
      if (!operation || !key) return { success: false, error: 'Not authenticated' }
      const collection = await createVault(key, payload.name, {
        assertCurrent: operation.assertCurrent,
        mutation: collectionMutation(payload, 'create'),
      })
      const data = await tryActiveRendererSnapshot(key, collection.activeVaultId, deps)
      if (!data) {
        if (!collection.alreadyCommitted) recordCommittedAudit(deps, 'vault.collection.created', collection.activeVaultId)
        operation.release()
        operation = null
        await deps.lockVault(true, 'active-vault-snapshot-unavailable')
        return { success: false, error: 'Vault changed but its new snapshot is unavailable. Vaultage was locked for safety.' }
      }
      if (!collection.alreadyCommitted) {
        recordCommittedAudit(deps, 'vault.collection.created', collection.activeVaultId)
        publishActiveVault(deps, collection.activeVaultId, data)
      }
      return {
        success: true,
        collection,
        data: data.snapshot,
        ...(collection.alreadyCommitted ? { alreadyCommitted: true } : {}),
      }
    } catch (error) {
      return failure(error)
    } finally {
      operation?.release()
    }
  })

  ipcMain.handle(contracts.switchVault.channel, async (_, rawPayload: unknown) => {
    let operation: ReturnType<VaultIpcDeps['beginSessionOperation']> = null
    try {
      const payload = contracts.switchVault.validate(rawPayload)
      const currentKey = deps.getVaultKey()
      if (!currentKey) return { success: false, error: 'Not authenticated' }
      const currentCollection = await readVaultCollection(currentKey)
      const target = currentCollection.vaults.find(vault => vault.id === payload.vaultId)
      // Let the serialized storage boundary inspect its receipt before it
      // rejects a missing/archived target. A lost response can be replayed
      // after a later collection change without reapplying the old switch.
      if (target && !target.archived && currentCollection.activeVaultId !== payload.vaultId) {
        await deps.beforeVaultScopeChange?.()
      }
      operation = deps.beginSessionOperation()
      const key = deps.getVaultKey()
      if (!operation || !key) return { success: false, error: 'Not authenticated' }
      const collection = await switchActiveVault(key, payload.vaultId, {
        assertCurrent: operation.assertCurrent,
        mutation: collectionMutation(payload, 'switch'),
      })
      const data = await tryActiveRendererSnapshot(key, payload.vaultId, deps)
      if (!data) {
        if (!collection.alreadyCommitted) recordCommittedAudit(deps, 'vault.collection.switched', payload.vaultId)
        operation.release()
        operation = null
        await deps.lockVault(true, 'active-vault-snapshot-unavailable')
        return { success: false, error: 'Vault changed but its new snapshot is unavailable. Vaultage was locked for safety.' }
      }
      if (!collection.alreadyCommitted) {
        recordCommittedAudit(deps, 'vault.collection.switched', payload.vaultId)
        publishActiveVault(deps, payload.vaultId, data)
      }
      return {
        success: true,
        collection,
        data: data.snapshot,
        ...(collection.alreadyCommitted ? { alreadyCommitted: true } : {}),
      }
    } catch (error) {
      return failure(error)
    } finally {
      operation?.release()
    }
  })

  ipcMain.handle(contracts.renameVault.channel, async (_, rawPayload: unknown) => {
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = contracts.renameVault.validate(rawPayload)
      const key = deps.getVaultKey()
      if (!key) return { success: false, error: 'Not authenticated' }
      const collection = await renameVault(key, payload.vaultId, payload.name, {
        assertCurrent: operation.assertCurrent,
        mutation: collectionMutation(payload, 'rename'),
      })
      if (!collection.alreadyCommitted) recordCommittedAudit(deps, 'vault.collection.renamed', payload.vaultId)
      return { success: true, collection, ...(collection.alreadyCommitted ? { alreadyCommitted: true } : {}) }
    } catch (error) {
      return failure(error)
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(contracts.setVaultArchived.channel, async (_, rawPayload: unknown) => {
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = contracts.setVaultArchived.validate(rawPayload)
      const key = deps.getVaultKey()
      if (!key) return { success: false, error: 'Not authenticated' }
      const collection = await setVaultArchived(key, payload.vaultId, payload.archived, {
        assertCurrent: operation.assertCurrent,
        mutation: collectionMutation(payload, 'archive'),
      })
      if (!collection.alreadyCommitted) {
        recordCommittedAudit(
          deps,
          payload.archived ? 'vault.collection.archived' : 'vault.collection.restored',
          payload.vaultId,
        )
      }
      return { success: true, collection, ...(collection.alreadyCommitted ? { alreadyCommitted: true } : {}) }
    } catch (error) {
      return failure(error)
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(contracts.deleteVault.channel, async (_, rawPayload: unknown) => {
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = contracts.deleteVault.validate(rawPayload)
      if (payload.confirmation !== `DELETE ${payload.vaultId}`) {
        return { success: false, error: 'Vault deletion confirmation does not match' }
      }
      const verified = await deps.authController.verifyMasterPassword(payload.masterPassword)
      if (!verified.success) return verified
      operation.assertCurrent()
      const key = deps.getVaultKey()
      if (!key) return { success: false, error: 'Not authenticated' }
      const collection = await deleteVault(key, payload.vaultId, {
        assertCurrent: operation.assertCurrent,
        mutation: collectionMutation(payload, 'delete'),
      })
      if (!collection.alreadyCommitted) recordCommittedAudit(deps, 'vault.collection.deleted', payload.vaultId)
      return { success: true, collection, ...(collection.alreadyCommitted ? { alreadyCommitted: true } : {}) }
    } catch (error) {
      return failure(error)
    } finally {
      operation.release()
    }
  })
}

async function activeRendererSnapshot(
  key: Buffer,
  vaultId: string,
  deps: VaultIpcDeps,
): Promise<{ revision: number; snapshot: unknown }> {
  const vault = await readVaultById(key, vaultId)
  const revision = vaultRevisionFrom(vault, 1)
  return {
    revision,
    snapshot: deps.decorateVaultSnapshot(redactVaultForRenderer(vault)),
  }
}

async function tryActiveRendererSnapshot(
  key: Buffer,
  vaultId: string,
  deps: VaultIpcDeps,
): Promise<{ revision: number; snapshot: unknown } | null> {
  try {
    return await activeRendererSnapshot(key, vaultId, deps)
  } catch (error) {
    // The collection commit is already durable. A follow-up publication read
    // must not turn a committed create/switch into a reported failure that the
    // renderer may retry as a second mutation.
    console.error('[vault] Could not publish committed active-vault snapshot:', error)
    return null
  }
}

function publishActiveVault(
  deps: VaultIpcDeps,
  vaultId: string,
  data: { revision: number; snapshot: unknown },
): void {
  try {
    deps.setVaultRevision(data.revision)
    deps.onVaultChanged?.({
      vaultId,
      revision: data.revision,
      data: data.snapshot,
      source: 'vault-switch',
    })
  } catch (error) {
    console.error('[vault] Could not publish committed active-vault state:', error)
  }
}

function recordCommittedAudit(
  deps: VaultIpcDeps,
  type: Extract<
    import('./audit').AuditEventType,
    `vault.collection.${string}`
  >,
  vaultId: string,
): void {
  try {
    deps.recordAudit(type, { vaultId })
  } catch (error) {
    // Storage is already committed. Audit failure follows the existing
    // fail-secure audit guard without inviting a renderer retry.
    console.error('[vault] Could not enqueue collection audit event:', error)
  }
}

function failure(error: unknown) {
  if (error instanceof StaleVaultCollectionMutationError) {
    return {
      success: false,
      stale: true,
      error: 'Vault collection changed while this action was pending. Refresh and try again.',
      collection: error.currentCollection,
    }
  }
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

function collectionMutation(
  payload: { operationId: string; expectedRevision: number; [key: string]: unknown },
  type: 'create' | 'switch' | 'rename' | 'archive' | 'delete',
): VaultCollectionMutationRequest {
  // Never persist confirmation or password material in a receipt fingerprint.
  const semantic = type === 'create'
    ? { type, expectedRevision: payload.expectedRevision, name: payload.name }
    : type === 'rename'
      ? { type, expectedRevision: payload.expectedRevision, vaultId: payload.vaultId, name: payload.name }
      : type === 'archive'
        ? { type, expectedRevision: payload.expectedRevision, vaultId: payload.vaultId, archived: payload.archived }
        : { type, expectedRevision: payload.expectedRevision, vaultId: payload.vaultId }
  return {
    operationId: payload.operationId,
    expectedRevision: payload.expectedRevision,
    fingerprint: createHash('sha256').update(JSON.stringify(semantic)).digest('hex'),
  }
}
