import type { IpcMain } from 'electron'
import { validateVaultSaveJson } from './security'
import { commitVaultUpdate } from './vaultStorage'
import { deriveVaultCrudAuditEntries } from './vaultCrudAudit'
import { isUsageOnlyRevisionRange } from './vaultUsageBatcher'
import { redactVaultForRenderer } from './vaultRedaction'
import { applyVaultMutationCommand } from './vaultCommandMutations'
import {
  auditEntriesFromVaultMutationReceipt,
  findVaultMutationReceipt,
  fingerprintVaultMutationCommand,
  withVaultMutationReceipt,
  type VaultMutationReceipt,
} from './vaultMutationReceipts'
import { vaultIpcContracts } from '../shared/vaultIpcContracts'
import { StaleVaultMutationError, vaultRevisionFrom, type VaultIpcDeps } from './vaultIpcCommon'

export function registerVaultDataIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  const vaultIpc = vaultIpcContracts

  ipcMain.handle(vaultIpc.mutate.channel, async (event, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.mutate.validate(rawPayload)
      const commandFingerprint = fingerprintVaultMutationCommand(payload.command)
      const committed = await commitVaultUpdate(vaultKey, async (currentVault) => {
        operation.assertCurrent()
        const vaultId = vaultRootId(currentVault)
        const currentRevision = vaultRevisionFrom(currentVault, deps.getVaultRevision())
        const priorReceipt = findVaultMutationReceipt(
          currentVault,
          payload.mutationId,
          commandFingerprint,
        )
        if (priorReceipt) {
          if (priorReceipt.vaultId !== vaultId) throw new Error('Vault mutation receipt scope does not match the active vault')
          const changedData = redactVaultForRenderer(currentVault)
          return {
            // The storage queue still owns this read/decision boundary. A
            // retry may re-encrypt the identical document, but it never
            // reapplies the command or advances the revision.
            json: validateVaultSaveJson(JSON.stringify(currentVault)),
            result: {
              revision: currentRevision,
              data: deps.decorateVaultSnapshot(changedData),
              changedData,
              commandResult: priorReceipt.commandResult,
              receipt: priorReceipt,
              alreadyCommitted: true,
            },
          }
        }
        if (
          payload.expectedRevision !== currentRevision &&
          !isUsageOnlyRevisionRange(currentVault, payload.expectedRevision, currentRevision)
        ) {
          throw new StaleVaultMutationError(
            currentRevision,
            deps.decorateVaultSnapshot(redactVaultForRenderer(currentVault)),
          )
        }
        // Revision validation intentionally precedes one-shot grant
        // consumption. A stale full-entity form must not burn a verification
        // grant it could never commit.
        const providerAuthorizedCommand = deps.authorizeProviderMutation?.(
          currentVault,
          payload.command,
          { sessionEpoch: operation.epoch, webContentsId: event.sender.id },
        ) ?? payload.command
        const authorizedCommand = await deps.authorizeCommercialMutation?.(
          currentVault,
          providerAuthorizedCommand,
        ) ?? providerAuthorizedCommand
        const pathAuthorizedCommand = await deps.authorizeProjectPathMutation(
          currentVault,
          authorizedCommand as typeof payload.command,
          { webContentsId: event.sender.id },
        )
        operation.assertCurrent()
        const nextRevision = currentRevision + 1
        const applied = applyVaultMutationCommand(currentVault, pathAuthorizedCommand as typeof payload.command)
        const next = { ...applied.vault, revision: nextRevision }
        const auditEntries = deriveVaultCrudAuditEntries(currentVault, next, nextRevision)
        const received = withVaultMutationReceipt(next, {
          id: payload.mutationId,
          vaultId,
          revision: nextRevision,
          commandType: payload.command.type,
          commandFingerprint,
          commandResult: applied.result,
          auditEntries,
        })
        const nextJson = validateVaultSaveJson(JSON.stringify(received.vault))
        const changedData = redactVaultForRenderer(received.vault)
        return {
          json: nextJson,
          result: {
            revision: nextRevision,
            data: deps.decorateVaultSnapshot(changedData),
            changedData,
            commandResult: applied.result,
            receipt: received.receipt,
            alreadyCommitted: false,
          },
        }
      })
      const result = committed.value
      publishCommittedRevision(deps, result.revision)
      if (!result.alreadyCommitted) publishCommittedMutation(deps, result.receipt, result.changedData)
      return {
        success: true,
        revision: result.revision,
        data: result.data,
        result: result.commandResult,
      }
    } catch (err) {
      if (err instanceof StaleVaultMutationError) {
        return {
          success: false,
          stale: true,
          error: 'Vault changed while this action was pending. The latest snapshot has been loaded; try the action again.',
          revision: err.currentRevision,
          data: err.currentSnapshot,
        }
      }
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.trackUsage.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.trackUsage.validate(rawPayload)
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })
}

function publishCommittedMutation(
  deps: VaultIpcDeps,
  receipt: VaultMutationReceipt,
  changedData: unknown,
): void {
  for (const entry of auditEntriesFromVaultMutationReceipt(receipt)) {
    try {
      deps.recordAudit(entry.type, entry.details)
    } catch (err) {
      // The encrypted receipt is already durable and is the reconciliation
      // source of truth. A synchronous publication failure must never turn a
      // committed mutation into a reported storage failure.
      console.error('[vault] Could not enqueue committed mutation audit entry:', err)
    }
  }
  try {
    deps.onVaultChanged?.({
      revision: receipt.revision,
      data: changedData,
      source: 'renderer-command',
      vaultId: receipt.vaultId,
    })
  } catch (err) {
    console.error('[vault] Could not publish committed mutation snapshot:', err)
  }
}

function vaultRootId(vault: unknown): string {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) throw new Error('Vault root is unavailable')
  const root = (vault as { root?: unknown }).root
  if (!root || typeof root !== 'object' || Array.isArray(root) || typeof (root as { id?: unknown }).id !== 'string') {
    throw new Error('Vault root is unavailable')
  }
  return (root as { id: string }).id
}

function publishCommittedRevision(deps: VaultIpcDeps, revision: number): void {
  try {
    deps.setVaultRevision(revision)
  } catch (err) {
    console.error('[vault] Could not publish committed mutation revision:', err)
  }
}
