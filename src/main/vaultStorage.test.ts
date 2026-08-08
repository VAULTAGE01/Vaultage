import { join } from 'path'
import { promises as fs } from 'fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultSessionKeyring } from './vaultSessionKey'
import { seal } from './vaultCrypto'
import { encodeVaultRecordStore } from './vaultRecordStore'
import { listVaultMutationReceipts } from './vaultMutationReceipts'

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
  VAULT_RECORDS_DIR,
  commitVaultUpdate,
  commitAuthCredentials,
  commitRecoveryEnvelope,
  commitRestoredVaultState,
  createVault,
  createVaultBackupSnapshot,
  createVaultState,
  deleteVault,
  getAuthStateStatus,
  readCredentials,
  readRecoveryEnvelope,
  readVault,
  readVaultBackupSnapshot,
  readVaultById,
  readVaultCollection,
  renameVault,
  setVaultArchived,
  switchActiveVault,
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

  it('atomically preserves, backs up, and revokes the active recovery envelope', async () => {
    await createVaultState(initialState({ marker: 'recovery' }))
    await commitRecoveryEnvelope(TEST_RECOVERY_ENVELOPE)
    await expect(readRecoveryEnvelope()).resolves.toEqual(TEST_RECOVERY_ENVELOPE)

    await commitAuthCredentials(paramsRaw('cc'), Buffer.alloc(48, 8))
    await expect(readRecoveryEnvelope()).resolves.toEqual(TEST_RECOVERY_ENVELOPE)

    const backupDir = join(testUserData, 'recovery-backup')
    await createVaultBackupSnapshot(backupDir, VAULT_KEY)
    const snapshot = await readVaultBackupSnapshot(backupDir)
    expect(snapshot.format).toBe('vaultage.backup.v3')
    expect(snapshot.recoveryEnvelope).toEqual(TEST_RECOVERY_ENVELOPE)

    const beforeRevocation = await readAuthStateManifest()
    expect(beforeRevocation.recoveryFile).toMatch(/^recovery\.[a-f0-9-]+\.json$/u)
    await commitRecoveryEnvelope(null)
    await expect(readRecoveryEnvelope()).resolves.toBeNull()
    if (beforeRevocation.recoveryFile) {
      await expect(fs.access(join(VAULT_DIR, beforeRevocation.recoveryFile)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    }
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

  it('does not publish a vault mutation when the agent client is revoked at the commit boundary', async () => {
    await createVaultState(initialState({ revision: 1 }))
    let current = true

    await expect(updateVault(VAULT_KEY, () => ({
      json: JSON.stringify(vaultData({ revision: 2 })),
      result: 2,
    }), {
      assertCurrentAsync: async () => {
        current = false
        if (!current) throw new Error('client_revoked')
      },
    })).rejects.toThrow('client_revoked')

    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ revision: 1 })
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

  it('migrates to Default, keeps stable ids, and switches exact vaults without cross-vault writes', async () => {
    await createVaultState(initialState({ marker: 'legacy-default', revision: 1 }))
    const active = await readAuthStateManifest()
    await fs.writeFile(
      join(VAULT_DIR, active.vaultFile),
      seal(Buffer.from(JSON.stringify(vaultData({ marker: 'legacy-default', revision: 1 })), 'utf8'), VAULT_KEY),
    )
    await expect(readVaultCollection(VAULT_KEY)).resolves.toEqual({
      revision: 1,
      activeVaultId: 'root',
      vaults: [{
        id: 'root',
        name: 'Default',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        archived: false,
      }],
    })

    const created = await createVault(VAULT_KEY, 'Work', {
      id: 'vault-work',
      now: '2026-08-02T13:00:00.000Z',
    })
    expect(created).toMatchObject({ revision: 2, activeVaultId: 'vault-work' })
    await updateVault(VAULT_KEY, current => ({
      json: JSON.stringify({ ...(current as Record<string, unknown>), marker: 'work-only', revision: 2 }),
      result: undefined,
    }))

    await expect(readVaultById(VAULT_KEY, 'root')).resolves.toMatchObject({ marker: 'legacy-default' })
    await expect(readVaultById(VAULT_KEY, 'vault-work')).resolves.toMatchObject({ marker: 'work-only' })
    await switchActiveVault(VAULT_KEY, 'root')
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ marker: 'legacy-default' })
    await expect(readVaultById(VAULT_KEY, 'missing')).rejects.toThrow('Vault does not exist')
    await expect(readVaultById(VAULT_KEY, ' root')).rejects.toThrow('Invalid vault id')
  })

  it('scopes a historical receipt to Default during single-vault collection migration', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const active = await readAuthStateManifest()
    const legacyReceipt = {
      id: 'legacy-default-receipt',
      revision: 3,
      commandType: 'preferences.patch',
      commandFingerprint: 'a'.repeat(64),
      audit: [{ type: 'vault.preferences.updated' }],
    }
    await fs.writeFile(
      join(VAULT_DIR, active.vaultFile),
      seal(Buffer.from(JSON.stringify(vaultData({
        _vaultage: { recentMutationReceipts: [legacyReceipt] },
      })), 'utf8'), VAULT_KEY),
    )

    await readVaultCollection(VAULT_KEY)
    expect(listVaultMutationReceipts(await readVault(VAULT_KEY))).toMatchObject([{
      id: 'legacy-default-receipt',
      vaultId: 'root',
      legacyAuditScope: true,
    }])
  })

  it('replays a lost collection response exactly once and rejects a concurrent stale revision', async () => {
    await createVaultState(initialState({ revision: 1 }))
    await readVaultCollection(VAULT_KEY)
    const mutation = {
      operationId: 'collection-create-work',
      expectedRevision: 1,
      fingerprint: 'a'.repeat(64),
    }

    const committed = await createVault(VAULT_KEY, 'Work', {
      id: 'vault-work',
      now: '2026-08-02T13:00:00.000Z',
      mutation,
    })
    expect(committed).toMatchObject({ revision: 2, activeVaultId: 'vault-work' })

    const replay = await createVault(VAULT_KEY, 'Work', {
      id: 'vault-work',
      now: '2026-08-02T13:00:00.000Z',
      mutation,
    })
    expect(replay).toMatchObject({ revision: 2, activeVaultId: 'vault-work', alreadyCommitted: true })
    await expect(readVaultCollection(VAULT_KEY)).resolves.toMatchObject({
      revision: 2,
      vaults: [{ id: 'root' }, { id: 'vault-work' }],
    })

    await expect(createVault(VAULT_KEY, 'Concurrent', {
      id: 'vault-concurrent',
      mutation: {
        operationId: 'collection-stale-write',
        expectedRevision: 1,
        fingerprint: 'b'.repeat(64),
      },
    })).rejects.toThrow('Vault collection revision is stale')
  })

  it('replays a prior switch receipt before rejecting its now-archived target', async () => {
    await createVaultState(initialState({ revision: 1 }))
    await readVaultCollection(VAULT_KEY)
    await createVault(VAULT_KEY, 'Work', {
      id: 'vault-work',
      now: '2026-08-02T13:00:00.000Z',
    })
    await switchActiveVault(VAULT_KEY, 'root')
    const switchReceipt = {
      operationId: 'switch-to-work-replay',
      expectedRevision: 3,
      fingerprint: 'c'.repeat(64),
    }
    const committed = await switchActiveVault(VAULT_KEY, 'vault-work', { mutation: switchReceipt })
    expect(committed).toMatchObject({ revision: 4, activeVaultId: 'vault-work' })
    await switchActiveVault(VAULT_KEY, 'root')
    await setVaultArchived(VAULT_KEY, 'vault-work', true)

    const replay = await switchActiveVault(VAULT_KEY, 'vault-work', { mutation: switchReceipt })
    expect(replay).toMatchObject({ revision: 4, activeVaultId: 'vault-work', alreadyCommitted: true })
  })

  it('migrates a prior single-record manifest without changing its vault id or data', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const historical = vaultData({ marker: 'prior-record-store', revision: 7 })
    const encoded = await encodeVaultRecordStore(historical, VAULT_KEY, VAULT_RECORDS_DIR)
    const active = await readAuthStateManifest()
    await fs.writeFile(
      join(VAULT_DIR, active.vaultFile),
      seal(Buffer.from(JSON.stringify(encoded.manifest), 'utf8'), VAULT_KEY),
    )

    await expect(readVaultCollection(VAULT_KEY)).resolves.toMatchObject({
      revision: 1,
      activeVaultId: 'root',
      vaults: [{ id: 'root', name: 'Default' }],
    })
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({
      marker: 'prior-record-store',
      revision: 7,
      root: { id: 'root' },
    })
  })

  it('leaves historical ciphertext unchanged when migration is interrupted before rename', async () => {
    await createVaultState(initialState({ revision: 1 }))
    const active = await readAuthStateManifest()
    const vaultPath = join(VAULT_DIR, active.vaultFile)
    const historicalBlob = seal(
      Buffer.from(JSON.stringify(vaultData({ marker: 'interrupted-legacy', revision: 1 })), 'utf8'),
      VAULT_KEY,
    )
    await fs.writeFile(vaultPath, historicalBlob)
    let assertions = 0

    await expect(readVault(VAULT_KEY, {
      assertCurrent: () => {
        assertions += 1
        if (assertions >= 3) throw new Error('simulated migration interruption')
      },
    })).rejects.toThrow('simulated migration interruption')

    expect(await fs.readFile(vaultPath)).toEqual(historicalBlob)
    await expect(readVault(VAULT_KEY)).resolves.toMatchObject({ marker: 'interrupted-legacy' })
    await expect(readVaultCollection(VAULT_KEY)).resolves.toMatchObject({
      activeVaultId: 'root',
      vaults: [{ id: 'root', name: 'Default' }],
    })
  })

  it('requires switch-before-archive, archive-before-delete, and preserves the final vault', async () => {
    await createVaultState(initialState({ revision: 1 }))
    await createVault(VAULT_KEY, 'Disposable', {
      id: 'vault-disposable',
      now: '2026-08-02T13:00:00.000Z',
    })
    await expect(setVaultArchived(VAULT_KEY, 'vault-disposable', true))
      .rejects.toThrow('Switch away')
    await switchActiveVault(VAULT_KEY, 'root')
    await expect(deleteVault(VAULT_KEY, 'vault-disposable')).rejects.toThrow('Archive the vault')
    await setVaultArchived(VAULT_KEY, 'vault-disposable', true, {
      now: '2026-08-02T14:00:00.000Z',
    })
    await expect(readVaultById(VAULT_KEY, 'vault-disposable')).rejects.toThrow('Vault is archived')
    await expect(readVaultById(VAULT_KEY, 'vault-disposable', { includeArchived: true }))
      .resolves.toMatchObject({ root: { id: 'vault-disposable' } })
    await renameVault(VAULT_KEY, 'vault-disposable', 'Archived work', {
      now: '2026-08-02T15:00:00.000Z',
    })
    await deleteVault(VAULT_KEY, 'vault-disposable')
    await expect(readVaultCollection(VAULT_KEY)).resolves.toMatchObject({
      activeVaultId: 'root',
      vaults: [{ id: 'root' }],
    })
    await expect(setVaultArchived(VAULT_KEY, 'root', true)).rejects.toThrow('active vault')
    await expect(deleteVault(VAULT_KEY, 'root')).rejects.toThrow('active vault')
  })

  it('does not publish an interrupted collection mutation', async () => {
    await createVaultState(initialState({ revision: 1 }))
    let assertions = 0
    await expect(createVault(VAULT_KEY, 'Interrupted', {
      id: 'vault-interrupted',
      assertCurrent: () => {
        assertions += 1
        if (assertions >= 2) throw new Error('simulated session interruption')
      },
    })).rejects.toThrow('simulated session interruption')
    await expect(readVaultCollection(VAULT_KEY)).resolves.toMatchObject({
      activeVaultId: 'root',
      vaults: [{ id: 'root' }],
    })
  })

  it('backs up and restores the whole vault collection', async () => {
    await createVaultState(initialState({ marker: 'default', revision: 1 }))
    await createVault(VAULT_KEY, 'Work', {
      id: 'vault-work',
      now: '2026-08-02T13:00:00.000Z',
    })
    await updateVault(VAULT_KEY, current => ({
      json: JSON.stringify({ ...(current as Record<string, unknown>), marker: 'work', revision: 2 }),
      result: undefined,
    }))
    const backupDir = join(testUserData, 'multi-vault-backup')
    await createVaultBackupSnapshot(backupDir, VAULT_KEY)
    const snapshot = await readVaultBackupSnapshot(backupDir)
    await switchActiveVault(VAULT_KEY, 'root')
    await commitRestoredVaultState(snapshot, VAULT_KEY)

    await expect(readVaultCollection(VAULT_KEY)).resolves.toMatchObject({ activeVaultId: 'vault-work' })
    await expect(readVaultById(VAULT_KEY, 'root')).resolves.toMatchObject({ marker: 'default' })
    await expect(readVaultById(VAULT_KEY, 'vault-work')).resolves.toMatchObject({ marker: 'work' })
  })

  it('round-trips a valid multi-vault attachment union larger than the legacy backup cap', async () => {
    await createVaultState(initialState(imageVaultData('root', 'default-image', 1)))
    await createVault(VAULT_KEY, 'Work', {
      id: 'vault-work',
      now: '2026-08-02T13:00:00.000Z',
    })
    await updateVault(VAULT_KEY, () => ({
      json: JSON.stringify(imageVaultData('vault-work', 'work-image', 2)),
      result: undefined,
    }))
    await createVault(VAULT_KEY, 'Archive', {
      id: 'vault-archive',
      now: '2026-08-02T14:00:00.000Z',
    })
    await updateVault(VAULT_KEY, () => ({
      json: JSON.stringify(imageVaultData('vault-archive', 'archive-image', 3)),
      result: undefined,
    }))

    const backupDir = join(testUserData, 'multi-vault-attachment-backup')
    await createVaultBackupSnapshot(backupDir, VAULT_KEY)
    const snapshot = await readVaultBackupSnapshot(backupDir)
    expect(snapshot.attachmentBlobs?.size).toBe(3)

    await switchActiveVault(VAULT_KEY, 'root')
    await commitRestoredVaultState(snapshot, VAULT_KEY)
    await expect(readVaultById(VAULT_KEY, 'vault-archive')).resolves.toMatchObject({
      marker: 'archive-image',
    })
  }, 30_000)
})

const VAULT_KEY = Buffer.alloc(32, 7)
const TEST_RECOVERY_ENVELOPE = {
  format: 'vaultage.recovery-kit.v1' as const,
  generation: 'recovery-generation',
  createdAt: '2026-08-02T12:00:00.000Z',
  vaultFingerprint: '1234-5678-90AB-CDEF',
  kdf: {
    name: 'scrypt' as const,
    N: 131072,
    r: 8,
    p: 1,
    keylen: 32,
    salt: 'ab'.repeat(32),
  },
  wrappedVaultKey: Buffer.alloc(60, 4).toString('base64'),
}

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

function imageVaultData(vaultId: string, marker: string, fill: number) {
  const image = Buffer.alloc(6 * 1024 * 1024, fill).toString('base64')
  return vaultData({
    marker,
    revision: 1,
    root: {
      id: vaultId,
      name: marker,
      children: [],
      secrets: [{
        id: `${vaultId}-image`,
        name: marker,
        type: 'image',
        fields: [{
          key: '__image__',
          value: `data:image/png;base64,${image}`,
          sensitive: true,
        }],
        notes: '',
        createdAt: '2026-08-02T12:00:00.000Z',
        updatedAt: '2026-08-02T12:00:00.000Z',
      }],
      itemOrder: [{ kind: 'secret', id: `${vaultId}-image` }],
    },
  })
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
  readonly recoveryFile?: string
}> {
  const parsed: unknown = JSON.parse(await fs.readFile(AUTH_STATE_MANIFEST_FILE, 'utf8'))
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError('Expected the auth-state test fixture to contain an object')
  }
  const vaultFile = Reflect.get(parsed, 'vaultFile')
  const credentialsFile = Reflect.get(parsed, 'credentialsFile')
  const recoveryFile = Reflect.get(parsed, 'recoveryFile')
  if (typeof vaultFile !== 'string' || typeof credentialsFile !== 'string') {
    throw new TypeError('Expected the auth-state test fixture to name both active files')
  }
  if (recoveryFile !== undefined && typeof recoveryFile !== 'string') {
    throw new TypeError('Expected the auth-state recovery file to be a string')
  }
  return { vaultFile, credentialsFile, ...(recoveryFile ? { recoveryFile } : {}) }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
