import { join } from 'path'
import { promises as fs } from 'fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultSessionKeyring } from './vaultSessionKey'
import { seal } from './vaultCrypto'

const testUserData = vi.hoisted(() => (
  `/tmp/vaultage-storage-test-${process.pid}-${Math.random().toString(16).slice(2)}`
))

vi.mock('electron', () => ({
  app: { getPath: () => testUserData },
}))

import {
  AUTH_STATE_MANIFEST_FILE,
  VAULT_DIR,
  VAULT_FILE,
  commitVaultUpdate,
  commitAuthCredentials,
  commitRestoredVaultState,
  createVaultBackupSnapshot,
  createVaultState,
  getAuthStateStatus,
  readCredentials,
  readVault,
  readVaultBackupSnapshot,
  updateVault,
} from './vaultStorage'

describe('vaultStorage transactional state', () => {
  beforeEach(async () => {
    await fs.rm(testUserData, { recursive: true, force: true })
  })

  afterAll(async () => {
    await fs.rm(testUserData, { recursive: true, force: true })
  })

  it('publishes first-run state with one manifest and refuses replacement setup', async () => {
    expect(await getAuthStateStatus()).toBe('missing')
    await createVaultState(initialState({ marker: 'original' }))

    expect(await getAuthStateStatus()).toBe('ready')
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ marker: 'original' })
    await expect(createVaultState(initialState({ marker: 'replacement' }))).rejects.toThrow(
      'Vault is already initialized',
    )
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ marker: 'original' })

    const manifest = await readAuthStateManifest()
    expect(manifest.vaultFile).toMatch(/^vault\.[a-f0-9-]+\.enc$/)
    expect(manifest.credentialsFile).toMatch(/^credentials\.[a-f0-9-]+\.json$/)
    await expect(fs.access(VAULT_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('switches password credentials with a single atomic manifest commit', async () => {
    await createVaultState(initialState({ marker: 'credentials' }))
    const beforeManifest = await fs.readFile(AUTH_STATE_MANIFEST_FILE, 'utf8')
    const beforeCredentials = await readCredentials()

    // A crash that leaves an unreferenced generation cannot affect active reads.
    await fs.writeFile(join(VAULT_DIR, 'credentials.orphan.json'), '{"broken":true}')
    expect(await readCredentials()).toEqual(beforeCredentials)

    const nextParams = paramsRaw('bb')
    const nextWrapped = Buffer.alloc(48, 9)
    await commitAuthCredentials(nextParams, nextWrapped)
    expect(await fs.readFile(AUTH_STATE_MANIFEST_FILE, 'utf8')).not.toBe(beforeManifest)
    await expect(readCredentials()).resolves.toEqual({
      paramsRaw: nextParams,
      wrappedKey: nextWrapped,
    })
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ marker: 'credentials' })
  })

  it('serializes concurrent create attempts so exactly one can initialize the vault', async () => {
    const results = await Promise.allSettled([
      createVaultState(initialState({ marker: 'first' })),
      createVaultState(initialState({ marker: 'second' })),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(['first', 'second']).toContain(recordField(await readVault(VAULT_KEY), 'marker'))
  })

  it('rejects an in-flight vault mutation after lock and preserves the prior ciphertext', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const session = new VaultSessionKeyring()
    const installing = session.beginOperation()
    if (!installing) throw new TypeError('Expected an unlocked session operation')
    session.installKey(VAULT_KEY, installing.epoch)
    installing.release()
    const currentKey = session.currentKey()
    if (!currentKey) throw new TypeError('Expected an installed session key')
    const updaterEntered = deferred<void>()
    const continueUpdater = deferred<void>()

    const mutation = updateVault(currentKey, async () => {
      updaterEntered.resolve()
      await continueUpdater.promise
      return { json: JSON.stringify(vaultData({ revision: 2 })), result: 2 }
    })
    await updaterEntered.promise
    const locking = session.invalidate()
    continueUpdater.resolve()

    await expect(mutation).rejects.toThrow('Vault session changed')
    await locking
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ revision: 1 })
  })

  it('does not report failure when the session changes immediately after rename', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const session = new VaultSessionKeyring()
    const installing = session.beginOperation()
    if (!installing) throw new TypeError('Expected an unlocked session operation')
    session.installKey(VAULT_KEY, installing.epoch)
    installing.release()
    const currentKey = session.currentKey()
    if (!currentKey) throw new TypeError('Expected an installed session key')
    const originalRename = fs.rename.bind(fs)
    let locking: Promise<boolean> | null = null
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      await originalRename(source, destination)
      // The ciphertext is now visible at the active path. Invalidation is
      // immediate, while invalidate() waits for this update's key lease to be
      // released, so do not await it from inside the rename hook.
      locking ??= session.invalidate()
    })

    try {
      const mutation = updateVault(currentKey, () => ({
        json: JSON.stringify(vaultData({ revision: 2 })),
        result: 2,
      }))

      await expect(mutation).resolves.toBe(2)
      expect(locking).not.toBeNull()
      await locking

      // The caller and durable state now agree about the commit boundary.
      await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ revision: 2 })
    } finally {
      rename.mockRestore()
    }
  })

  it('exposes the atomic post-rename commit outcome explicitly', async () => {
    await createVaultState(initialState({ revision: 1 }))

    await expect(commitVaultUpdate(VAULT_KEY, () => ({
      json: JSON.stringify(vaultData({ revision: 2 })),
      result: { revision: 2 },
    }))).resolves.toEqual({
      status: 'committed',
      value: { revision: 2 },
    })
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ revision: 2 })
  })

  it('creates a self-validating consistent backup and restores it by manifest switch', async () => {
    await createVaultState(initialState({ marker: 'backup-source', revision: 1 }))
    const backupDir = join(testUserData, 'portable-backup')
    await createVaultBackupSnapshot(backupDir, VAULT_KEY)
    const snapshot = await readVaultBackupSnapshot(backupDir)

    await updateVault(VAULT_KEY, () => ({
      json: JSON.stringify(vaultData({ marker: 'newer-live-data', revision: 2 })),
      result: undefined,
    }))
    await commitRestoredVaultState(snapshot, VAULT_KEY)
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({
      marker: 'backup-source',
      revision: 1,
    })

    await fs.writeFile(join(backupDir, 'vault.enc'), Buffer.from('tampered'))
    await expect(readVaultBackupSnapshot(backupDir)).rejects.toThrow('Backup integrity check failed')
  })

  it('treats partial legacy state as recovery-only and never as a fresh setup', async () => {
    await fs.mkdir(VAULT_DIR, { recursive: true })
    await fs.writeFile(VAULT_FILE, Buffer.from('partial'))
    expect(await getAuthStateStatus()).toBe('incomplete')
    await expect(createVaultState(initialState({ marker: 'replacement' }))).rejects.toThrow(
      'setup cannot replace it',
    )
  })

  it('rejects structurally invalid plaintext before encryption and preserves active data', async () => {
    await createVaultState(initialState({ marker: 'valid', revision: 1 }))

    await expect(updateVault(VAULT_KEY, () => ({
      json: JSON.stringify(vaultData({
        revision: 2,
        envProjects: [{
          id: 'project-1',
          name: 'App',
          path: '/tmp/app',
          addToGitignore: true,
          entries: [{ secretId: 'missing', fieldKey: 'API Key', envKey: 'API_KEY' }],
        }],
      })),
      result: undefined,
    }))).rejects.toThrow('references a missing secret')

    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ marker: 'valid', revision: 1 })
  })

  it('rejects a structurally corrupt vault after authenticated decryption', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const manifest = await readAuthStateManifest()
    const invalid = vaultData({
      revision: 2,
      root: {
        id: 'root',
        name: 'Vault',
        children: [],
        secrets: [],
        itemOrder: [{ kind: 'secret', id: 'missing' }],
      },
    })
    await fs.writeFile(
      join(VAULT_DIR, manifest.vaultFile),
      seal(Buffer.from(JSON.stringify(invalid), 'utf8'), VAULT_KEY),
    )

    await expect(readVault(VAULT_KEY)).rejects.toThrow('references an item outside its folder')
  })

  it('upgrades authenticated legacy image fields to the sensitive shape before validation', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const manifest = await readAuthStateManifest()
    const legacy = vaultData({
      revision: 1,
      preferences: { localDashboardPinnedOrder: ['secret:removed-secret'] },
      root: {
        id: 'root',
        name: 'Vault',
        children: [],
        secrets: [{
          id: 'legacy-image',
          name: 'Legacy image',
          type: 'image',
          fields: [{ key: '__image__', value: 'data:image/png;base64,AAAA', sensitive: false }],
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        itemOrder: [{ kind: 'secret', id: 'legacy-image' }],
      },
    })
    await fs.writeFile(
      join(VAULT_DIR, manifest.vaultFile),
      seal(Buffer.from(JSON.stringify(legacy), 'utf8'), VAULT_KEY),
    )

    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({
      preferences: { localDashboardPinnedOrder: [] },
      root: {
        secrets: [{
          id: 'legacy-image',
          fields: [{ key: '__image__', sensitive: true }],
        }],
      },
    })
  })
})

const VAULT_KEY = Buffer.alloc(32, 7)

function initialState(extra: Record<string, unknown>) {
  return {
    paramsRaw: paramsRaw('aa'),
    wrappedKey: Buffer.alloc(48, 3),
    vaultJson: JSON.stringify(vaultData(extra)),
    vaultKey: VAULT_KEY,
  }
}

function vaultData(extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    root: { id: 'root', name: 'Vault', children: [], secrets: [], itemOrder: [] },
    providers: [],
    providerGroups: [],
    envProjects: [],
    ...extra,
  }
}

function paramsRaw(saltByte: string): string {
  return JSON.stringify({
    version: 2,
    scrypt: {
      N: 131072,
      r: 8,
      p: 1,
      keylen: 32,
      salt: saltByte.repeat(32),
    },
  })
}

function recordField(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

async function readAuthStateManifest(): Promise<{
  readonly vaultFile: string
  readonly credentialsFile: string
}> {
  const parsed: unknown = JSON.parse(await fs.readFile(AUTH_STATE_MANIFEST_FILE, 'utf8'))
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError('Expected the auth-state test fixture to contain an object')
  }
  const vaultFile = Reflect.get(parsed, 'vaultFile')
  const credentialsFile = Reflect.get(parsed, 'credentialsFile')
  if (typeof vaultFile !== 'string' || typeof credentialsFile !== 'string') {
    throw new TypeError('Expected the auth-state test fixture to name both active files')
  }
  return { vaultFile, credentialsFile }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
