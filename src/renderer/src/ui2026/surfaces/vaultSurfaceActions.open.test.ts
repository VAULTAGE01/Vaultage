import { describe, expect, it } from 'vitest'
import { createVaultSurfaceActions } from './vaultSurfaceActions.open'

describe('Community Vault UI2026 actions', () => {
  it('selects a secret before handing off to the folder workspace', () => {
    const calls: string[] = []
    const actions = createVaultSurfaceActions({
      selectFolder: (id) => calls.push('folder:' + id),
      selectSecret: (id) => calls.push('secret:' + id),
      onOpenLegacyWorkspace: (view) => calls.push('workspace:' + view),
    })

    actions.openSecret({
      id: 'secret-1',
      folderId: 'folder-1',
      folderName: 'API keys',
      name: 'API key',
      type: 'apiKey',
      environment: 'production',
      timestamp: '2026-07-24T00:00:00.000Z',
    })

    expect(calls).toEqual([
      'folder:folder-1',
      'secret:secret-1',
      'workspace:folders',
    ])
  })

  it('hands workspace actions to the dashboard without dropping selection semantics', () => {
    const calls: string[] = []
    const actions = createVaultSurfaceActions({
      selectFolder: () => undefined,
      selectSecret: () => undefined,
      onOpenLegacyWorkspace: (view) => calls.push(view),
    })

    actions.openWorkspace()

    expect(calls).toEqual(['dashboard'])
  })

  it('opens folder search results in the folder workspace', () => {
    const calls: string[] = []
    const actions = createVaultSurfaceActions({
      selectFolder: (id) => calls.push('folder:' + id),
      selectSecret: (id) => calls.push('secret:' + id),
      onOpenLegacyWorkspace: (view) => calls.push('workspace:' + view),
    })

    actions.openSearchResult({
      kind: 'folder',
      id: 'archive',
      name: 'Archive',
      count: 2,
    })

    expect(calls).toEqual([
      'folder:archive',
      'secret:null',
      'workspace:folders',
    ])
  })
})
