import { clipboard, nativeImage, type IpcMain } from 'electron'
import { Buffer } from 'buffer'
import {
  validateQuickRevealPinInput,
  validateVaultSaveJson,
} from './security'
import { updateVault } from './vaultStorage'
import { resolveSecretFieldInVault, resolveSecretFieldsInVault } from './vaultMutations'
import { redactVaultForRenderer } from './vaultRedaction'
import {
  createQuickRevealPinRecord,
  optionalQuickRevealPin,
  requireQuickRevealPin,
  resetQuickRevealPinThrottle,
} from './quickRevealPin'
import { vaultIpcContracts } from '../shared/vaultIpcContracts'
import { VAULT_VALIDATION_LIMITS } from '../shared/vaultValidation'
import {
  cloneRecord,
  isRecord,
  vaultRevisionFrom,
  type VaultIpcDeps,
} from './vaultIpcCommon'

export function registerVaultSecretIpc(ipcMain: IpcMain, deps: VaultIpcDeps): void {
  const vaultIpc = vaultIpcContracts

  ipcMain.handle(vaultIpc.copySecretField.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.copySecretField.validate(rawPayload)
      const clearAfterMs = clipboardClearAfterMs(payload.clearAfterMs)
      const vault = await deps.readVault(vaultKey)
      operation.assertCurrent()
      const copiedValue = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      if (copiedValue.length > 1_000_000) throw new Error('Clipboard text is too large')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      clipboard.writeText(copiedValue)
      deps.recordSecretUsage(payload.secretId, usedAt)
      deps.recordAudit('vault.secret.copied', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'text',
      })
      if (clearAfterMs > 0 && copiedValue) {
        const timer = setTimeout(() => {
          if (clipboard.readText() === copiedValue) clipboard.writeText('')
        }, clearAfterMs)
        timer.unref?.()
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.copySecretImageField.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.copySecretImageField.validate(rawPayload)
      const vault = await deps.readVault(vaultKey)
      operation.assertCurrent()
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      writeImageDataUrlToClipboard(value)
      deps.recordSecretUsage(payload.secretId, usedAt)
      deps.recordAudit('vault.secret.copied', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'image',
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.revealSecretField.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.revealSecretField.validate(rawPayload)
      const pin = optionalQuickRevealPin(payload.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Reveal saved secret value from Vaultage',
          payload.confirmationPhrase,
        )
        if (!confirmation.success) return confirmation
        resetQuickRevealPinThrottle()
      }
      const vault = await deps.readVault(vaultKey)
      if (pin) await requireQuickRevealPin(vault, pin)
      operation.assertCurrent()
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      if (Buffer.byteLength(value, 'utf8') > 1_000_000) throw new Error('Secret field is too large to reveal')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      deps.recordAudit('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'text',
        method: pin ? 'pin' : 'system',
      })
      return { success: true, value }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.revealSecretImageField.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.revealSecretImageField.validate(rawPayload)
      const pin = optionalQuickRevealPin(payload.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Reveal saved secret image from Vaultage',
          payload.confirmationPhrase,
        )
        if (!confirmation.success) return confirmation
        resetQuickRevealPinThrottle()
      }
      const vault = await deps.readVault(vaultKey)
      if (pin) await requireQuickRevealPin(vault, pin)
      operation.assertCurrent()
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      validateImageDataUrl(value)
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      deps.recordAudit('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'image',
        method: pin ? 'pin' : 'system',
      })
      return { success: true, value }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.revealSecretFields.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.revealSecretFields.validate(rawPayload)
      const pin = optionalQuickRevealPin(payload.pin)
      if (!pin) {
        const confirmation = deps.authController.confirmSecretReveal(
          'Reveal pinned secret values from Vaultage',
          payload.confirmationPhrase,
        )
        if (!confirmation.success) return confirmation
        resetQuickRevealPinThrottle()
      }
      const vault = await deps.readVault(vaultKey)
      if (pin) await requireQuickRevealPin(vault, pin)
      operation.assertCurrent()
      const fields = resolveSecretFieldsInVault(vault, payload.secretId)
      const totalBytes = fields.reduce((sum, field) => sum + Buffer.byteLength(field.value, 'utf8'), 0)
      if (totalBytes > 1_000_000) throw new Error('Secret is too large to reveal')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      deps.recordAudit('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        kind: 'fields',
        method: pin ? 'pin' : 'system',
      })
      return { success: true, fields }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.setRevealPin.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.setRevealPin.validate(rawPayload)
      const pin = validateQuickRevealPinInput(payload.pin)
      const verified = await deps.authController.verifyMasterPassword(payload.masterPassword)
      if (!verified.success) return verified
      resetQuickRevealPinThrottle()
      const quickRevealPin = await createQuickRevealPinRecord(pin)
      const result = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const current = isRecord(vault) ? vault : {}
        const preferences = isRecord(current.preferences) ? current.preferences : {}
        const next = {
          ...current,
          revision: nextRevision,
          preferences: {
            ...preferences,
            quickRevealPin,
            quickRevealPinEnabled: true,
          },
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return {
          json: safeJson,
          result: {
            revision: nextRevision,
            data: deps.decorateVaultSnapshot(redactVaultForRenderer(next)),
          },
        }
      })
      deps.setVaultRevision(result.revision)
      deps.recordAudit('vault.reveal_pin.changed', { action: 'set' })
      return { success: true, revision: result.revision, data: result.data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(vaultIpc.clearRevealPin.channel, async (_, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    try {
      const payload = vaultIpc.clearRevealPin.validate(rawPayload)
      const verified = await deps.authController.verifyMasterPassword(payload.masterPassword)
      if (!verified.success) return verified
      resetQuickRevealPinThrottle()
      const result = await updateVault(vaultKey, (vault) => {
        const nextRevision = vaultRevisionFrom(vault, deps.getVaultRevision()) + 1
        const current = isRecord(vault) ? vault : {}
        const preferences = isRecord(current.preferences) ? cloneRecord(current.preferences) : {}
        delete preferences.quickRevealPin
        preferences.quickRevealPinEnabled = false
        const next = {
          ...current,
          revision: nextRevision,
          preferences,
        }
        const safeJson = validateVaultSaveJson(JSON.stringify(next))
        return {
          json: safeJson,
          result: {
            revision: nextRevision,
            data: deps.decorateVaultSnapshot(redactVaultForRenderer(next)),
          },
        }
      })
      deps.setVaultRevision(result.revision)
      deps.recordAudit('vault.reveal_pin.changed', { action: 'clear' })
      return { success: true, revision: result.revision, data: result.data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}

function clipboardClearAfterMs(value: unknown): number {
  if (value === undefined || value === null) return 30_000
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000
  if (value <= 0) return 0
  return Math.min(Math.floor(value), 120_000)
}

function writeImageDataUrlToClipboard(dataUrl: string): void {
  const bytes = validateImageDataUrl(dataUrl)
  const img = nativeImage.createFromBuffer(bytes)
  if (img.isEmpty()) throw new Error('Clipboard image is invalid')
  clipboard.writeImage(img)
}

function validateImageDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Invalid image data URL')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.byteLength > VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes) {
    throw new Error('Clipboard image is too large')
  }
  const img = nativeImage.createFromBuffer(bytes)
  if (img.isEmpty()) throw new Error('Clipboard image is invalid')
  return bytes
}
