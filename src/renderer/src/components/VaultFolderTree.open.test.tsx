import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VaultFolder } from '../types'

vi.mock('#service-categories', () => ({
  providerTypeCategory: () => 'developer-tools',
  serviceCategoryLabel: () => 'Developer Tools',
}))

import VaultFolderTree from './VaultFolderTree.open'

const root: VaultFolder = {
  id: 'vault-personal',
  name: 'Personal',
  children: [{
    id: 'api-keys',
    name: 'API keys',
    children: [],
    secrets: [],
    itemOrder: [],
  }],
  secrets: [{
    id: 'root-secret',
    name: 'Root secret',
    type: 'apiKey',
    tags: [],
    fields: [],
    notes: '',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  }],
  itemOrder: [
    { kind: 'folder', id: 'api-keys' },
    { kind: 'secret', id: 'root-secret' },
  ],
}

describe('VaultFolderTree', () => {
  it('lets the top-level vault own the root label while keeping its folders and secrets visible', () => {
    const html = renderToStaticMarkup(
      <VaultFolderTree
        root={root}
        hideRoot
        selectedFolderId={null}
        selectedSecretId={null}
        draggedItem={null}
        activeDropFolderId={null}
        onOpenFolder={() => undefined}
        onOpenSecret={() => undefined}
        onDragItem={() => undefined}
        onDragEnd={() => undefined}
        onDropFolderHover={() => undefined}
        onDropItem={() => undefined}
      />,
    )

    expect(html).toContain('data-vault-folder-root-hidden')
    expect(html).not.toContain('>Personal<')
    expect(html).toContain('>API keys<')
    expect(html).toContain('>Root secret<')
  })
})
