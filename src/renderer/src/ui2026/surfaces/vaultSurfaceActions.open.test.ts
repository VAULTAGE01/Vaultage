import { describe, expect, it } from 'vitest'
import { createVaultSurfaceActions } from './vaultSurfaceActions.open'

describe('Community Vault UI2026 actions', () => {
  it('selects a secret before opening its UI2026 detail', () => {
    const calls: string[] = []
    const actions = createVaultSurfaceActions({
      selectFolder: (id) => calls.push('folder:' + id),
      selectSecret: (id) => calls.push('secret:' + id),
      onOpenDetail: target => calls.push('detail:' + target.kind + ':' + target.id),
      onOpenWorkflow: workflow => calls.push('workflow:' + workflow),
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
      'detail:secret:secret-1',
    ])
  })

  it('routes every Vault quick action to its UI2026 workflow without opening the legacy workspace', () => {
    const calls: string[] = []
    const actions = createVaultSurfaceActions({
      selectFolder: () => undefined,
      selectSecret: () => undefined,
      onOpenDetail: () => undefined,
      onOpenWorkflow: workflow => calls.push('workflow:' + workflow),
    })

    actions.openAddSecret()
    actions.openImportOrExport()
    actions.openNewCollection()
    actions.openVaultSettings()

    expect(calls).toEqual([
      'workflow:add-secret',
      'workflow:import-export',
      'workflow:new-collection',
      'workflow:settings',
    ])
  })

  it('opens folder search results in UI2026 collection detail', () => {
    const calls: string[] = []
    const actions = createVaultSurfaceActions({
      selectFolder: (id) => calls.push('folder:' + id),
      selectSecret: (id) => calls.push('secret:' + id),
      onOpenDetail: target => calls.push('detail:' + target.kind + ':' + target.id),
      onOpenWorkflow: workflow => calls.push('workflow:' + workflow),
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
      'detail:collection:archive',
    ])
  })
})
