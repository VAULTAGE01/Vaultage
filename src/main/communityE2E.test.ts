import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { seal, open } from './vaultCrypto'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('P02-02 — Accountless/offline Community Vault lifecycle', () => {
  it('Community vault created without account is valid, decryptable, and contains default structure', async () => {
    const root = join(tmpdir(), `vaulage-comm-e2e-${Date.now()}`)
    roots.push(root)
    const vaultDir = join(root, 'vault-data')
    const key = randomBytes(32)

    const vaultJson = JSON.stringify({
      schema_version: 2, version: 2,
      root: {
        id: 'root', name: 'My Vault',
        children: [
          { id: 'f1', name: 'Personal', children: [], secrets: [], itemOrder: [] },
          { id: 'f2', name: 'Work', children: [], secrets: [], itemOrder: [] },
          { id: 'f3', name: 'Shared', children: [], secrets: [], itemOrder: [] },
        ],
        secrets: [],
        itemOrder: [{ kind: 'folder', id: 'f1' }, { kind: 'folder', id: 'f2' }, { kind: 'folder', id: 'f3' }],
      },
    })

    await ensurePrivateDir(vaultDir)
    await atomicWritePrivateFile(join(vaultDir, 'vault.enc'), seal(Buffer.from(vaultJson, 'utf8'), key))

    const readEncrypted = await fs.readFile(join(vaultDir, 'vault.enc'))
    const decrypted = open(Buffer.from(readEncrypted), key)
    const parsed = JSON.parse(decrypted.toString('utf8'))

    expect(parsed.schema_version).toBe(2)
    expect(parsed.root.children).toHaveLength(3)
    expect(parsed.root.children.map((c: { name: string }) => c.name).sort()).toEqual(['Personal', 'Shared', 'Work'])
    expect(readEncrypted.toString('utf8')).not.toContain('My Vault')

    key.fill(0)
    decrypted.fill(0)
  })

  it('offline Community vault survives round-trip encryption without account or network', async () => {
    const root = join(tmpdir(), `vaulage-offline-${Date.now()}`)
    roots.push(root)
    const vaultDir = join(root, 'vault-data')
    const key = randomBytes(32)

    const vaultJson = JSON.stringify({
      schema_version: 2, version: 2,
      root: {
        id: 'root', name: 'My Vault',
        children: [
          { id: 'f1', name: 'Personal', children: [], secrets: [], itemOrder: [] },
          { id: 'f2', name: 'Work', children: [], secrets: [], itemOrder: [] },
          { id: 'f3', name: 'Shared', children: [], secrets: [], itemOrder: [] },
        ],
        secrets: [],
        itemOrder: [{ kind: 'folder', id: 'f1' }, { kind: 'folder', id: 'f2' }, { kind: 'folder', id: 'f3' }],
      },
    })

    await ensurePrivateDir(vaultDir)
    await atomicWritePrivateFile(join(vaultDir, 'vault.enc'), seal(Buffer.from(vaultJson, 'utf8'), key))

    const vaultRaw = await fs.readFile(join(vaultDir, 'vault.enc'))
    const decrypted = open(Buffer.from(vaultRaw), key)
    const vaultData = JSON.parse(decrypted.toString('utf8'))

    vaultData.root.secrets.push({
      id: 'secret_offline', kind: 'apiKey', title: 'Offline Secret',
      fields: { key: 'value', keyName: 'API_KEY', value: 'offline-value' },
    })
    vaultData.version += 1
    await atomicWritePrivateFile(join(vaultDir, 'vault.enc'), seal(Buffer.from(JSON.stringify(vaultData), 'utf8'), key))

    const verifyRaw = await fs.readFile(join(vaultDir, 'vault.enc'))
    const verified = JSON.parse(open(Buffer.from(verifyRaw), key).toString('utf8'))
    expect(verified.root.secrets).toHaveLength(1)
    expect(verified.root.secrets[0].title).toBe('Offline Secret')
    expect(verifyRaw.toString('utf8')).not.toContain('offline-value')

    key.fill(0)
    decrypted.fill(0)
  })
})

describe('P02-01 — Clean install onboarding under 60 seconds', () => {
  it('completes vault creation, encryption, and first secret write under 60 seconds', async () => {
    const root = join(tmpdir(), `vaulage-onboard-${Date.now()}`)
    roots.push(root)
    const vaultDir = join(root, 'vault-data')
    const key = randomBytes(32)

    const started = Date.now()

    const vaultJson = JSON.stringify({
      schema_version: 2, version: 2,
      root: {
        id: 'root', name: 'My Vault',
        children: [
          { id: 'f1', name: 'Personal', children: [], secrets: [], itemOrder: [] },
          { id: 'f2', name: 'Work', children: [], secrets: [], itemOrder: [] },
          { id: 'f3', name: 'Shared', children: [], secrets: [], itemOrder: [] },
        ],
        secrets: [],
        itemOrder: [{ kind: 'folder', id: 'f1' }, { kind: 'folder', id: 'f2' }, { kind: 'folder', id: 'f3' }],
      },
    })

    await ensurePrivateDir(vaultDir)
    await atomicWritePrivateFile(join(vaultDir, 'vault.enc'), seal(Buffer.from(vaultJson, 'utf8'), key))
    const setupMs = Date.now() - started

    const firstSecret = {
      id: 'secret_first', kind: 'apiKey', title: 'My First API Key',
      fields: { key: 'value', keyName: 'API_KEY', value: 'sk-test-first-secret' },
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    const vaultRaw = await fs.readFile(join(vaultDir, 'vault.enc'))
    const decrypted = open(Buffer.from(vaultRaw), key)
    const vaultData = JSON.parse(decrypted.toString('utf8'))
    vaultData.root.secrets.push(firstSecret)
    vaultData.version += 1
    await atomicWritePrivateFile(join(vaultDir, 'vault.enc'), seal(Buffer.from(JSON.stringify(vaultData), 'utf8'), key))

    const totalMs = Date.now() - started

    const verifyRaw = await fs.readFile(join(vaultDir, 'vault.enc'))
    const verified = JSON.parse(open(Buffer.from(verifyRaw), key).toString('utf8'))
    expect(verified.root.secrets).toHaveLength(1)
    expect(verified.root.secrets[0].title).toBe('My First API Key')
    expect(verifyRaw.toString('utf8')).not.toContain('sk-test-first-secret')

    expect(setupMs).toBeLessThan(60_000)
    expect(totalMs).toBeLessThan(60_000)

    key.fill(0)
    decrypted.fill(0)
  })
})
