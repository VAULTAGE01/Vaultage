import { BrowserWindow, clipboard, dialog, nativeImage, type IpcMain } from 'electron'
import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import { atomicWritePrivateFile } from './fileIO'
import { assertSafeImageDimensions } from './imageDimensions'
import {
  validateQuickRevealPinInput,
  validateVaultSaveJson,
} from './security'
import { updateVault } from './vaultStorage'
import {
  assertPinnedSecretInVault,
  assertSecretRevealAllowedInVault,
  resolveSecretFieldInVault,
  resolveSecretFieldsInVault,
  secretFieldIsSensitiveInVault,
} from './vaultMutations'
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
    let clipboardFingerprint: string | null = null
    try {
      const payload = vaultIpc.copySecretField.validate(rawPayload)
      const clearAfterMs = 30_000
      const vault = await deps.readVault(vaultKey)
      operation.assertCurrent()
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      const pin = optionalQuickRevealPin(payload.pin)
      if (secretFieldIsSensitiveInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)) {
        if (pin) {
          assertPinnedSecretInVault(vault, payload.secretId)
          await requireQuickRevealPin(vault, pin)
        } else {
          const confirmation = deps.authController.confirmSecretReveal(
            'Copy saved secret value from Vaultage',
            payload.confirmationPhrase,
          )
          if (!confirmation.success) return confirmation
          resetQuickRevealPinThrottle()
        }
      }
      const copiedValue = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      if (copiedValue.length > 1_000_000) throw new Error('Clipboard text is too large')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      clipboard.writeText(copiedValue)
      clipboardFingerprint = copiedValue ? textFingerprint(copiedValue) : null
      await deps.recordAuditDurable('vault.secret.copied', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'text',
        method: pin ? 'pin' : 'system',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      if (clearAfterMs > 0 && clipboardFingerprint) {
        const expectedFingerprint = clipboardFingerprint
        const timer = setTimeout(() => {
          if (textFingerprint(clipboard.readText()) === expectedFingerprint) clipboard.writeText('')
        }, clearAfterMs)
        timer.unref?.()
      }
      return { success: true }
    } catch (err) {
      if (clipboardFingerprint && textFingerprint(clipboard.readText()) === clipboardFingerprint) {
        clipboard.writeText('')
      }
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
    let clipboardFingerprint: string | null = null
    try {
      const payload = vaultIpc.copySecretImageField.validate(rawPayload)
      const clearAfterMs = 30_000
      const vault = await deps.readVault(vaultKey)
      operation.assertCurrent()
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      const confirmation = deps.authController.confirmSecretReveal(
        'Copy saved secret image from Vaultage',
        payload.confirmationPhrase,
      )
      if (!confirmation.success) return confirmation
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      clipboardFingerprint = writeImageDataUrlToClipboard(value)
      await deps.recordAuditDurable('vault.secret.copied', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'image',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
      if (clearAfterMs > 0 && clipboardFingerprint) {
        const expectedFingerprint = clipboardFingerprint
        const timer = setTimeout(() => {
          if (currentClipboardImageFingerprint() === expectedFingerprint) clipboard.clear()
        }, clearAfterMs)
        timer.unref?.()
      }
      return { success: true }
    } catch (err) {
      if (clipboardFingerprint && currentClipboardImageFingerprint() === clipboardFingerprint) clipboard.clear()
      return { success: false, error: String(err) }
    } finally {
      operation.release()
    }
  })

  ipcMain.handle(vaultIpc.saveSecretImageField.channel, async (event, rawPayload: unknown) => {
    const vaultKey = deps.getVaultKey()
    if (!vaultKey) return { success: false, error: 'Not authenticated' }
    const operation = deps.beginSessionOperation()
    if (!operation) return { success: false, error: 'Not authenticated' }
    let committedPath: string | null = null
    try {
      const payload = vaultIpc.saveSecretImageField.validate(rawPayload)
      const vault = await deps.readVault(vaultKey)
      operation.assertCurrent()
      const revision = vaultRevisionFrom(vault, deps.getVaultRevision())
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      const decoded = decodeImageDataUrl(value)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'Secret image window is unavailable' }
      const options = {
        title: 'Save secret image',
        defaultPath: `vaultage-secret-image.${decoded.extension}`,
        filters: [{ name: decoded.label, extensions: [decoded.extension] }],
      }
      const result = await dialog.showSaveDialog(win, options)
      if (result.canceled) return { success: false, cancelled: true }
      operation.assertCurrent()
      if (deps.getVaultRevision() !== revision) throw new Error('Vault changed during image export; try again')
      const confirmation = deps.authController.confirmPlaintextExport(
        'Confirm plaintext secret image export from Vaultage',
        payload.plaintextConfirmation,
      )
      if (!confirmation.success) return confirmation
      operation.assertCurrent()
      if (deps.getVaultRevision() !== revision) throw new Error('Vault changed during image export; try again')
      await deps.recordAuditDurable('vault.plaintext_release.authorized', {
        action: 'secret-image-export',
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        format: decoded.extension,
        itemCount: 1,
      })
      operation.assertCurrent()
      if (deps.getVaultRevision() !== revision) throw new Error('Vault changed during image export; try again')
      await atomicWritePrivateFile(result.filePath!, decoded.bytes, {
        beforeCommit: operation.assertCurrent,
      })
      committedPath = result.filePath!
      await deps.recordAuditDurable('vault.exported_plaintext', {
        scopeKind: 'secret-field',
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        format: decoded.extension,
        itemCount: 1,
      })
      return { success: true, path: result.filePath }
    } catch (err) {
      return {
        success: false,
        committed: committedPath !== null,
        path: committedPath ?? undefined,
        error: committedPath
          ? `The image was saved, but its completion audit could not be recorded; Vaultage has locked for safety: ${String(err)}`
          : String(err),
      }
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
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      if (pin) {
        assertPinnedSecretInVault(vault, payload.secretId)
        await requireQuickRevealPin(vault, pin)
      }
      operation.assertCurrent()
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      if (Buffer.byteLength(value, 'utf8') > 1_000_000) throw new Error('Secret field is too large to reveal')
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      await deps.recordAuditDurable('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'text',
        method: pin ? 'pin' : 'system',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
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
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      if (pin) {
        assertPinnedSecretInVault(vault, payload.secretId)
        await requireQuickRevealPin(vault, pin)
      }
      operation.assertCurrent()
      const value = resolveSecretFieldInVault(vault, payload.secretId, payload.fieldKey, payload.fieldId)
      validateImageDataUrl(value)
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      await deps.recordAuditDurable('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        field: payload.fieldKey,
        kind: 'image',
        method: pin ? 'pin' : 'system',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
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
      assertSecretRevealAllowedInVault(vault, payload.secretId)
      if (pin) {
        assertPinnedSecretInVault(vault, payload.secretId)
        await requireQuickRevealPin(vault, pin)
      }
      operation.assertCurrent()
      const fields = resolveSecretFieldsInVault(vault, payload.secretId)
      let textBytes = 0
      let imageBytes = 0
      for (const field of fields) {
        if (field.key === '__image__' || field.value.startsWith('data:image/')) {
          imageBytes += validateImageDataUrl(field.value).byteLength
        } else {
          textBytes += Buffer.byteLength(field.value, 'utf8')
        }
      }
      if (textBytes > 1_000_000) throw new Error('Secret text is too large to reveal')
      if (imageBytes > VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytesAggregate) {
        throw new Error('Secret images are too large to reveal together')
      }
      const usedAt = new Date().toISOString()
      operation.assertCurrent()
      await deps.recordAuditDurable('vault.secret.revealed', {
        vaultItemId: payload.secretId,
        kind: 'fields',
        method: pin ? 'pin' : 'system',
      })
      operation.assertCurrent()
      deps.recordSecretUsage(payload.secretId, usedAt)
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

function writeImageDataUrlToClipboard(dataUrl: string): string {
  const bytes = decodeImageDataUrl(dataUrl).bytes
  const img = nativeImage.createFromBuffer(bytes)
  if (img.isEmpty()) throw new Error('Clipboard image is invalid')
  const fingerprint = createHash('sha256').update(img.toPNG()).digest('hex')
  clipboard.writeImage(img)
  return fingerprint
}

function validateImageDataUrl(dataUrl: string): Buffer {
  return decodeImageDataUrl(dataUrl).bytes
}

function decodeImageDataUrl(dataUrl: string): {
  bytes: Buffer
  extension: 'png' | 'jpg' | 'gif' | 'webp'
  label: string
} {
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Invalid image data URL')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.byteLength > VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes) {
    throw new Error('Clipboard image is too large')
  }
  const detected = detectImageFormat(bytes)
  const mime = match[1].toLowerCase()
  const declared = mime === 'jpeg' ? 'jpg' : mime
  if (!detected || detected !== declared) throw new Error('Image content does not match its declared format')
  assertSafeImageDimensions(bytes, detected)
  const img = nativeImage.createFromBuffer(bytes)
  if (img.isEmpty()) throw new Error('Clipboard image is invalid')
  if (mime === 'jpeg' || mime === 'jpg') return { bytes, extension: 'jpg', label: 'JPEG image' }
  if (mime === 'gif') return { bytes, extension: 'gif', label: 'GIF image' }
  if (mime === 'webp') return { bytes, extension: 'webp', label: 'WebP image' }
  return { bytes, extension: 'png', label: 'PNG image' }
}

function detectImageFormat(bytes: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 6) {
    const gif = bytes.subarray(0, 6).toString('ascii')
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif'
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return null
}

function currentClipboardImageFingerprint(): string | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  return createHash('sha256').update(image.toPNG()).digest('hex')
}

function textFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
