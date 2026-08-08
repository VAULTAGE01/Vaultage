import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { installRendererDom, type StubElement } from '../test/fakeRendererDom'
import { VaultScopeBoundary } from './VaultScopeBoundary'

let rootElement: StubElement
let root: Root | undefined

beforeAll(() => {
  rootElement = installRendererDom().root
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
})

function ProjectEditor({ vaultId, projectId }: { vaultId: string; projectId: string }) {
  // Real project ids can be duplicated across independent vaults. This state
  // represents the edit modal draft that must not survive a root switch.
  const [draft] = useState(() => `${vaultId}:${projectId}`)
  return <output aria-label="project-editor-draft">{draft}</output>
}

describe('VaultScopeBoundary', () => {
  it('remounts a duplicate-project-id modal draft when the active vault changes', async () => {
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(
        VaultScopeBoundary,
        { vaultId: 'vault-a' },
        createElement(ProjectEditor, { vaultId: 'vault-a', projectId: 'project-shared' }),
      ))
    })
    expect(rootElement.textContent).toContain('vault-a:project-shared')

    await act(async () => {
      root?.render(createElement(
        VaultScopeBoundary,
        { vaultId: 'vault-b' },
        createElement(ProjectEditor, { vaultId: 'vault-b', projectId: 'project-shared' }),
      ))
    })

    expect(rootElement.textContent).toContain('vault-b:project-shared')
    expect(rootElement.textContent).not.toContain('vault-a:project-shared')
  })
})
