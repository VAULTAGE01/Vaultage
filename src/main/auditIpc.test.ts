import { join } from 'path'
import { promises as fs } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'

const mocks = vi.hoisted(() => ({
  auditDir: `/tmp/vaultage-audit-ipc-${process.pid}`,
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
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

    const result = await handlers.get('audit:export-json')?.({}, undefined) as {
      success: boolean
      path: string
    }
    expect(result).toEqual({ success: true, path: exportFile })
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
})

function deps(overrides: Partial<AuditIpcDeps> = {}): AuditIpcDeps {
  return {
    hasVaultKey: () => true,
    getAuditMacKey: () => Buffer.from(macKeyForDeps()),
    flushAuditQueue: async () => undefined,
    recordAudit: vi.fn(),
    ...overrides,
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
