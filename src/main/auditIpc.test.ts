import { join } from 'path'
import { promises as fs } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'

const mocks = vi.hoisted(() => ({
  auditDir: `/tmp/vaultage-audit-ipc-${process.pid}`,
  showSaveDialog: vi.fn(),
  fromWebContents: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}))

vi.mock('./vaultStorage', () => ({
  AUDIT_LOG_FILE: `${mocks.auditDir}/audit.log`,
}))

import { appendAuditEvent, deriveAuditMacKey } from './audit'
import { registerAuditIpc, type AuditIpcDeps } from './auditIpc'

describe('audit IPC integrity boundary', () => {
  const auditFile = join(mocks.auditDir, 'audit.log')
  const exportFile = join(mocks.auditDir, 'export.json')
  let macKey: Buffer

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.fromWebContents.mockReturnValue({ id: 'sender-window' })
    await fs.rm(mocks.auditDir, { recursive: true, force: true })
    await fs.mkdir(mocks.auditDir, { recursive: true })
    macKey = deriveAuditMacKey(Buffer.from('audit-ipc-test-vault-key'))
  })

  afterEach(async () => {
    macKey.fill(0)
    await fs.rm(mocks.auditDir, { recursive: true, force: true })
  })

  it('returns only fully anchored and verified events', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', { method: 'password' }, macKey)
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps())

    const result = await handlers.get('audit:read')?.({}, undefined) as {
      success: boolean
      events: unknown[]
      verification: { ok: boolean }
    }
    expect(result).toMatchObject({ success: true, verification: { ok: true } })
    expect(result.events).toHaveLength(1)
  })

  it('fails closed when the vault session changes after the audit queue flush', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    const operation = sessionOperation({ failAtAssertion: 1 })
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps({ beginSessionOperation: () => operation }))

    const result = await handlers.get('audit:read')?.({ sender: { id: 7 } }, undefined) as {
      success: boolean
      error: string
      events?: unknown[]
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/session changed/i)
    expect(result.events).toBeUndefined()
    expect(operation.release).toHaveBeenCalledOnce()
  })

  it('revalidates the session after reading before returning audit records', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    const operation = sessionOperation({ failAtAssertion: 2 })
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps({ beginSessionOperation: () => operation }))

    const result = await handlers.get('audit:read')?.({ sender: { id: 7 } }, undefined) as {
      success: boolean
      error: string
      events?: unknown[]
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/session changed/i)
    expect(result.events).toBeUndefined()
    expect(operation.release).toHaveBeenCalledOnce()
  })

  it('fails closed without returning records when the authenticated prefix is truncated', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    await appendAuditEvent(auditFile, 'vault.lock', {}, macKey)
    const firstLine = (await fs.readFile(auditFile, 'utf8')).split('\n')[0]
    await fs.writeFile(auditFile, `${firstLine}\n`, 'utf8')
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps())

    const result = await handlers.get('audit:read')?.({}, undefined) as {
      success: boolean
      error: string
      events?: unknown[]
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/truncated below its authenticated boundary/)
    expect(result.events).toBeUndefined()
  })

  it('exports the authenticated anchor with the verified retained events', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportFile })
    const recordAudit = vi.fn()
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps({ recordAudit }))

    const sender = { id: 7 }
    const result = await handlers.get('audit:export-json')?.({ sender }, undefined) as {
      success: boolean
      path: string
    }
    expect(result).toEqual({ success: true, path: exportFile })
    expect(mocks.fromWebContents).toHaveBeenCalledWith(sender)
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      { id: 'sender-window' },
      expect.objectContaining({ title: 'Export Vaultage Audit Log' }),
    )
    const exported = JSON.parse(await fs.readFile(exportFile, 'utf8')) as {
      verification: { ok: boolean }
      anchor: { format: string; totalEventCount: number; mac: string }
      events: unknown[]
    }
    expect(exported.verification).toEqual({ ok: true })
    expect(exported.anchor).toMatchObject({
      format: 'vaultage.audit-anchor.v1',
      totalEventCount: 1,
    })
    expect(exported.anchor.mac).toMatch(/^[a-f0-9]{64}$/)
    expect(exported.events).toHaveLength(1)
    expect(recordAudit).toHaveBeenCalledWith('audit.exported', expect.objectContaining({ count: 1 }))
  })

  it('refuses an export when the invoking renderer no longer has a window', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    mocks.fromWebContents.mockReturnValue(null)
    const operation = sessionOperation()
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps({ beginSessionOperation: () => operation }))

    const result = await handlers.get('audit:export-json')?.({ sender: { id: 7 } }, undefined) as {
      success: boolean
      error: string
    }
    expect(result).toEqual({ success: false, error: 'Audit window is unavailable' })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    expect(operation.release).toHaveBeenCalledOnce()
  })

  it('removes the staged export when the session changes at the atomic commit boundary', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportFile })
    const operation = sessionOperation({ failAtAssertion: 4 })
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps({ beginSessionOperation: () => operation }))

    const result = await handlers.get('audit:export-json')?.({ sender: { id: 7 } }, undefined) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/session changed/i)
    await expect(fs.stat(exportFile)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(operation.release).toHaveBeenCalledOnce()
  })

  it('reports an atomically committed export as success even if audit publication throws', async () => {
    await appendAuditEvent(auditFile, 'vault.unlock', {}, macKey)
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exportFile })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const operation = sessionOperation()
    const { handlers, ipcMain } = fakeIpcMain()
    registerAuditIpc(ipcMain, deps({
      beginSessionOperation: () => operation,
      recordAudit: () => { throw new Error('synthetic audit publication failure') },
    }))

    const result = await handlers.get('audit:export-json')?.({ sender: { id: 7 } }, undefined)
    expect(result).toEqual({ success: true, path: exportFile })
    expect(JSON.parse(await fs.readFile(exportFile, 'utf8'))).toMatchObject({
      verification: { ok: true },
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[audit] Could not enqueue committed audit export event:',
      expect.any(Error),
    )
    expect(operation.release).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})

function deps(overrides: Partial<AuditIpcDeps> = {}): AuditIpcDeps {
  return {
    hasVaultKey: () => true,
    getAuditMacKey: () => Buffer.from(macKeyForDeps()),
    beginSessionOperation: () => sessionOperation(),
    flushAuditQueue: async () => undefined,
    recordAudit: vi.fn(),
    ...overrides,
  }
}

function sessionOperation(options: { failAtAssertion?: number } = {}) {
  let assertions = 0
  return {
    epoch: 1,
    assertCurrent: vi.fn(() => {
      assertions += 1
      if (assertions === options.failAtAssertion) throw new Error('Vault session changed; unlock and try again')
    }),
    release: vi.fn(),
  }
}

function macKeyForDeps(): Buffer {
  return deriveAuditMacKey(Buffer.from('audit-ipc-test-vault-key'))
}

function fakeIpcMain(): {
  handlers: Map<string, (event: unknown, payload: unknown) => unknown>
  ipcMain: IpcMain
} {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>()
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, listener)
    },
  } as unknown as IpcMain
  return { handlers, ipcMain }
}
