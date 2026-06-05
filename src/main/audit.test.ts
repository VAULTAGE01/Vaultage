import { mkdtemp, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import {
  appendAuditEvent,
  createAuditEvent,
  deriveAuditMacKey,
  parseAuditLog,
  sanitizeAuditDetails,
  verifyAuditChain,
} from './audit'

describe('audit log', () => {
  it('creates deterministic hash-chained events', () => {
    const first = createAuditEvent(
      'vault.unlock',
      { method: 'password' },
      null,
      '2026-05-18T10:00:00.000Z',
      'event-1',
    )
    const second = createAuditEvent(
      'agent.request.approved',
      { requestId: 'req-1', envKeys: ['OPENAI_API_KEY'] },
      first.hash,
      '2026-05-18T10:01:00.000Z',
      'event-2',
    )

    expect(verifyAuditChain([first, second])).toEqual({ ok: true })
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(second.previousHash).toBe(first.hash)
  })

  it('detects edited audit events', () => {
    const first = createAuditEvent('vault.unlock', { method: 'touchid' }, null, '2026-05-18T10:00:00.000Z', 'event-1')
    const second = createAuditEvent('vault.lock', { reason: 'manual' }, first.hash, '2026-05-18T10:01:00.000Z', 'event-2')
    const tampered = { ...second, details: { reason: 'not manual' } }

    expect(verifyAuditChain([first, tampered])).toEqual({
      ok: false,
      index: 1,
      reason: 'event hash mismatch',
    })
  })

  it('detects removed audit events', () => {
    const first = createAuditEvent('vault.unlock', {}, null, '2026-05-18T10:00:00.000Z', 'event-1')
    const second = createAuditEvent('vault.lock', {}, first.hash, '2026-05-18T10:01:00.000Z', 'event-2')

    expect(verifyAuditChain([second])).toEqual({
      ok: false,
      index: 0,
      reason: 'previous hash mismatch',
    })
  })

  it('creates and verifies keyed audit events', () => {
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const first = createAuditEvent(
      'vault.unlock',
      { method: 'password' },
      null,
      '2026-05-18T10:00:00.000Z',
      'event-1',
      macKey,
    )
    const second = createAuditEvent(
      'vault.lock',
      { reason: 'manual' },
      first.hash,
      '2026-05-18T10:01:00.000Z',
      'event-2',
      macKey,
    )

    expect(first.hashScheme).toBe('hmac-sha256')
    expect(verifyAuditChain([first, second], { macKey, requireMac: true })).toEqual({ ok: true })
    expect(verifyAuditChain([first, second], { requireMac: true })).toEqual({
      ok: false,
      index: 0,
      reason: 'event MAC key unavailable',
    })
  })

  it('rejects legacy unkeyed events when keyed verification is required', () => {
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const event = createAuditEvent('vault.unlock', {}, null, '2026-05-18T10:00:00.000Z', 'event-1')

    expect(verifyAuditChain([event], { macKey, requireMac: true })).toEqual({
      ok: false,
      index: 0,
      reason: 'event MAC missing',
    })
  })

  it('redacts sensitive detail fields before hashing', () => {
    expect(sanitizeAuditDetails({
      requestId: 'req-1',
      value: 'secret-value',
      nested: {
        token: 'provider-token',
        envKeys: ['OPENAI_API_KEY'],
      },
    })).toEqual({
      requestId: 'req-1',
      value: '[redacted]',
      nested: {
        token: '[redacted]',
        envKeys: ['OPENAI_API_KEY'],
      },
    })
  })

  it('appends parseable NDJSON records with correct previous hashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))

    const first = await appendAuditEvent(file, 'vault.unlock', { method: 'password' }, macKey)
    const second = await appendAuditEvent(file, 'vault.lock', { reason: 'manual' }, macKey)
    const events = parseAuditLog(await readFile(file, 'utf8'))

    expect(events).toHaveLength(2)
    expect(events[0].hash).toBe(first.hash)
    expect(events[1].hash).toBe(second.hash)
    expect(events[1].previousHash).toBe(first.hash)
    expect(verifyAuditChain(events, { macKey, requireMac: true })).toEqual({ ok: true })
  })
})
