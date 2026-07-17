import { appendFile, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import {
  appendAuditEvent,
  auditAnchorPath,
  createAuditEvent,
  deriveAuditMacKey,
  parseAuditLog,
  readAuditLog,
  readVerifiedAuditLog,
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

  it('bounds nested audit detail collections before persistence', () => {
    const sanitized = sanitizeAuditDetails({
      items: Array.from({ length: 200 }, (_, index) => ({ index })),
      deeplyNested: { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too deep' } } } } } } } } },
    })

    const items = sanitized.items as unknown[]
    expect(items).toHaveLength(129)
    expect(items.at(-1)).toBe('[truncated 72 items]')
    expect(JSON.stringify(sanitized)).toContain('[truncated]')
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

  it('serializes concurrent appends into one valid hash chain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))

    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      appendAuditEvent(file, 'provider.action', { index }, macKey)
    )))

    const events = await readAuditLog(file)
    expect(events).toHaveLength(20)
    expect(verifyAuditChain(events, { macKey, requireMac: true })).toEqual({ ok: true })
  })

  it('quarantines a torn tail and continues from the last durable event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const first = await appendAuditEvent(file, 'vault.unlock', {}, macKey)
    await appendFile(file, '{"id":"torn"', 'utf8')

    const second = await appendAuditEvent(file, 'vault.lock', {}, macKey)
    const events = await readAuditLog(file)
    const recoveryFiles = (await readdir(dir)).filter(name => name.startsWith('audit.log.corrupt-'))

    expect(events.map(event => event.hash)).toEqual([first.hash, second.hash])
    expect(verifyAuditChain(events, { macKey, requireMac: true })).toEqual({ ok: true })
    expect(recoveryFiles).toHaveLength(1)
    expect(await readFile(join(dir, recoveryFiles[0]), 'utf8')).toBe('{"id":"torn"')
  })

  it('detects authenticated suffix truncation and refuses to append over it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))

    await appendAuditEvent(file, 'vault.unlock', {}, macKey)
    await appendAuditEvent(file, 'vault.lock', {}, macKey)
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n')
    await writeFile(file, `${lines[0]}\n`, 'utf8')

    await expect(readVerifiedAuditLog(file, macKey)).rejects.toThrow(/truncated below its authenticated boundary/)
    await expect(appendAuditEvent(file, 'vault.unlock', {}, macKey)).rejects.toThrow(/truncated below its authenticated boundary/)
  })

  it('authenticates the sidecar and rejects edits or the wrong vault key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    await appendAuditEvent(file, 'vault.unlock', {}, macKey)

    const wrongKey = deriveAuditMacKey(Buffer.from('different-vault-key-material'))
    await expect(readVerifiedAuditLog(file, wrongKey)).rejects.toThrow(/anchor MAC verification failed/)

    const anchorFile = auditAnchorPath(file)
    const anchor = JSON.parse(await readFile(anchorFile, 'utf8')) as { totalEventCount: number }
    anchor.totalEventCount += 1
    await writeFile(anchorFile, JSON.stringify(anchor), 'utf8')
    await expect(readVerifiedAuditLog(file, macKey)).rejects.toThrow(/anchor MAC verification failed/)
  })

  it('fails closed when an established anchor is removed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    await appendAuditEvent(file, 'vault.unlock', {}, macKey)

    await rm(auditAnchorPath(file))
    await expect(readVerifiedAuditLog(file, macKey)).rejects.toThrow(/anchor is missing after anchor enforcement/)
  })

  it('rejects symbolic-link substitution for audit storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const target = join(dir, 'unrelated-file')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    await writeFile(target, 'must not be consumed as an audit log', 'utf8')
    await symlink(target, file)

    await expect(appendAuditEvent(file, 'vault.unlock', {}, macKey)).rejects.toThrow(/not a regular file/)
    expect(await readFile(target, 'utf8')).toBe('must not be consumed as an audit log')
  })

  it('adopts only a valid keyed event written after the last durable anchor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const first = await appendAuditEvent(file, 'vault.unlock', {}, macKey)
    const durableButUnanchored = createAuditEvent(
      'vault.lock',
      { reason: 'crash-window' },
      first.hash,
      '2026-07-11T12:00:00.000Z',
      'event-after-anchor',
      macKey,
    )
    await appendFile(file, `${JSON.stringify(durableButUnanchored)}\n`, 'utf8')

    const recovered = await readVerifiedAuditLog(file, macKey)
    expect(recovered.events.map(event => event.id)).toEqual([first.id, 'event-after-anchor'])
    expect(recovered.anchor.totalEventCount).toBe(2)

    const forged = createAuditEvent(
      'vault.unlock',
      {},
      durableButUnanchored.hash,
      '2026-07-11T12:01:00.000Z',
      'unkeyed-forgery',
    )
    await appendFile(file, `${JSON.stringify(forged)}\n`, 'utf8')
    await expect(readVerifiedAuditLog(file, macKey)).rejects.toThrow(/event MAC missing/)
  })

  it('rotates into a bounded retained history while preserving cross-segment verification', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const rotation = { maxSegmentBytes: 256, maxArchiveSegments: 2 }

    for (let index = 0; index < 8; index++) {
      await appendAuditEvent(file, 'provider.action', { index }, macKey, rotation)
    }

    const verified = await readVerifiedAuditLog(file, macKey)
    const archiveFiles = (await readdir(dir)).filter(name => name.startsWith('audit.log.segment-'))
    expect(archiveFiles).toHaveLength(2)
    expect(verified.anchor.totalEventCount).toBe(8)
    expect(verified.anchor.archives).toHaveLength(2)
    expect(verified.anchor.retainedStartPreviousHash).toMatch(/^[a-f0-9]{64}$/)
    expect(verified.events.map(event => event.details.index)).toEqual([5, 6, 7])
    expect(verifyAuditChain(verified.events, {
      macKey,
      requireMac: true,
      initialPreviousHash: verified.anchor.retainedStartPreviousHash,
    })).toEqual({ ok: true })
    expect(await readAuditLog(file)).toHaveLength(3)

    for (const path of [file, auditAnchorPath(file), ...archiveFiles.map(name => join(dir, name))]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects tampering in an authenticated rotated segment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const rotation = { maxSegmentBytes: 256, maxArchiveSegments: 2 }
    await appendAuditEvent(file, 'provider.action', { index: 0 }, macKey, rotation)
    await appendAuditEvent(file, 'provider.action', { index: 1 }, macKey, rotation)

    const archive = (await readdir(dir)).find(name => name.startsWith('audit.log.segment-'))
    expect(archive).toBeTruthy()
    const archivePath = join(dir, archive!)
    const event = JSON.parse((await readFile(archivePath, 'utf8')).trim()) as { details: { index: number } }
    event.details.index = 9
    await writeFile(archivePath, `${JSON.stringify(event)}\n`, 'utf8')

    await expect(readVerifiedAuditLog(file, macKey)).rejects.toThrow(/failed verification: event hash mismatch/)
  })

  it('migrates a valid pre-anchor keyed log and rejects an unkeyed legacy log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaultage-audit-'))
    const file = join(dir, 'audit.log')
    const macKey = deriveAuditMacKey(Buffer.from('test-vault-key-material'))
    const first = createAuditEvent(
      'vault.unlock', {}, null, '2026-07-11T12:00:00.000Z', 'legacy-keyed', macKey,
    )
    await writeFile(file, JSON.stringify(first), { encoding: 'utf8', mode: 0o600 })

    const migrated = await readVerifiedAuditLog(file, macKey)
    expect(migrated.events).toHaveLength(1)
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true)
    expect(await readFile(auditAnchorPath(file), 'utf8')).toContain('vaultage.audit-anchor.v1')

    const secondFile = join(dir, 'unkeyed.log')
    const unkeyed = createAuditEvent('vault.unlock', {}, null, '2026-07-11T12:00:00.000Z', 'legacy-unkeyed')
    await writeFile(secondFile, `${JSON.stringify(unkeyed)}\n`, { encoding: 'utf8', mode: 0o600 })
    await expect(readVerifiedAuditLog(secondFile, macKey)).rejects.toThrow(/event MAC missing/)
  })
})
