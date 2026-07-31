import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { VaultFolder, VaultSecret } from '../types'
import {
  CommunityPinnedVaultLists,
  collectCommunityPinnedCollections,
} from './PinnedVaultLists.open'

function secret(id: string, pinned: boolean): VaultSecret {
  return {
    id,
    name: `Secret ${id}`,
    type: 'apiKey',
    fields: [],
    notes: '',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    tags: pinned ? ['pinned'] : undefined,
  }
}

function folder(
  id: string,
  name: string,
  secrets: VaultSecret[] = [],
  children: VaultFolder[] = [],
): VaultFolder {
  return { id, name, secrets, children }
}

describe('CommunityPinnedVaultLists', () => {
  it('derives pinned collections from local Vault folders without private capability data', () => {
    const root = folder('root', 'Vault', [], [
      folder('ops', 'Operations', [secret('one', true), secret('two', false)]),
      folder('empty', 'Unpinned', [secret('three', false)]),
    ])

    expect(collectCommunityPinnedCollections(root)).toEqual([
      {
        id: 'ops',
        name: 'Operations',
        path: 'Vault › Operations',
        secretCount: 2,
        pinnedSecretCount: 1,
      },
    ])
  })

  it('renders pinned secret and collection destinations without secret values', () => {
    const pinnedSecret = secret('one', true)
    const html = renderToStaticMarkup(
      <CommunityPinnedVaultLists
        pinnedSecrets={[{
          secret: pinnedSecret,
          folderId: 'ops',
          folderPath: 'Vault / Operations',
        }]}
        pinnedCollections={[{
          id: 'ops',
          name: 'Operations',
          path: 'Vault › Operations',
          secretCount: 2,
          pinnedSecretCount: 1,
        }]}
        onOpenSecret={() => undefined}
        onOpenCollection={() => undefined}
      />,
    )

    expect(html).toContain('Pinned secrets')
    expect(html).toContain('Pinned collections')
    expect(html).toContain('Secret one')
    expect(html).toContain('Operations')
    expect(html).not.toContain('provider')
    expect(html).not.toContain('Agent')
    expect(html).not.toContain('Services')
  })
})
