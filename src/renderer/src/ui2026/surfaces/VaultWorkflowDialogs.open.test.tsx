import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VaultWorkflowDialogs } from './VaultWorkflowDialogs.open'

vi.mock('../../vaultContext', () => ({
  useVault: () => ({
    state: { selectedFolderId: 'root', vault: { root: { id: 'root' } } },
    addFolder: vi.fn(),
    lock: vi.fn(),
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { readonly children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { readonly children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { readonly children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { readonly children: React.ReactNode }) => <h2>{children}</h2>,
}))

describe('Community Vault UI2026 workflow dialogs', () => {
  it.each([
    ['add-secret', 'New Secret'],
    ['import-export', 'Choose the transfer flow you want to open.'],
    ['new-collection', 'Create a collection in the selected Vault location.'],
    ['settings', 'Manage local Vault security controls.'],
  ] as const)('renders the %s quick-action flow without a legacy workspace handoff', (workflow, expected) => {
    const html = renderToStaticMarkup(<VaultWorkflowDialogs workflow={workflow} onClose={() => undefined} />)

    expect(html).toContain(expected)
    expect(html).not.toContain('Open existing Vault workspace')
  })

  it('labels both transfer paths explicitly', () => {
    const html = renderToStaticMarkup(<VaultWorkflowDialogs workflow='import-export' onClose={() => undefined} />)

    expect(html).toContain('Import secrets')
    expect(html).toContain('Export secrets')
  })
})
