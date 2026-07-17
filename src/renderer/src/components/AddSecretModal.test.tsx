import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VaultRoot, VaultSecret } from '../types'

const updateSecret = vi.fn()

const testVault: VaultRoot = {
  version: 2,
  revision: 19,
  root: {
    id: 'root',
    name: 'Vault',
    children: [],
    secrets: [],
    itemOrder: [],
  },
  providers: [],
  providerGroups: [],
  envProjects: [],
}

vi.mock('../vaultContext', () => ({
  useVault: () => ({
    state: {
      screen: 'unlocked',
      vault: testVault,
      selectedFolderId: 'root',
      selectedSecretId: null,
      error: null,
      saving: false,
      justCompletedSetup: false,
    },
    addSecret: vi.fn(),
    updateSecret,
  }),
}))

import AddSecretModal, {
  authoredRevisionForSecretUpdate,
  captureSecretFormAuthorship,
  secretFormSaveError,
} from '#add-secret-modal'

function existingSecret(): VaultSecret {
  return {
    id: 'secret-1',
    name: 'Production API',
    type: 'apiKey',
    fields: [{ id: 'field-1', key: 'token', value: '__VAULTAGE_REDACTED__', sensitive: true }],
    notes: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

describe('AddSecretModal edit concurrency', () => {
  it('keeps the revision from when a long-lived edit form was authored', () => {
    const authorship = captureSecretFormAuthorship(existingSecret(), 7)

    // A later remote snapshot may move the live vault to revision 19, but the
    // full-entity edit must continue to declare revision 7 and conflict.
    expect(authoredRevisionForSecretUpdate(authorship, 'secret-1')).toBe(7)
  })

  it('refuses to reuse an edit form for a different secret identity', () => {
    const authorship = captureSecretFormAuthorship(existingSecret(), 7)

    expect(() => authoredRevisionForSecretUpdate(authorship, 'secret-2'))
      .toThrow('Secret edit target changed')
  })

  it('turns a stale-revision failure into an actionable draft-preservation message', () => {
    const message = secretFormSaveError(new Error(
      'Vault changed while this action was pending. The latest snapshot has been loaded; try the action again.',
    ))

    expect(message).toContain('Your draft was not saved')
    expect(message).toContain('Close and reopen')
  })

  it('server-renders the editor shell without throwing or exposing a stored value', () => {
    const html = renderToStaticMarkup(
      <AddSecretModal folderId="root" existing={existingSecret()} onClose={vi.fn()} />,
    )

    expect(typeof html).toBe('string')
    expect(html).not.toContain('__VAULTAGE_REDACTED__')
  })
})
