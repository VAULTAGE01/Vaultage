import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultCollectionSnapshot } from '../../../../shared/vaultIpcContracts'
import { click, installRendererDom, StubElement } from '../../test/fakeRendererDom'

const vaultActions = vi.hoisted(() => ({
  listVaults: vi.fn(),
  createVault: vi.fn(),
  switchVault: vi.fn(),
  renameVault: vi.fn(),
  setVaultArchived: vi.fn(),
  deleteVault: vi.fn(),
}))

const vaultScope = vi.hoisted(() => ({ activeVaultId: 'vault-personal' }))
const vaultState = vi.hoisted(() => ({ collection: null as VaultCollectionSnapshot | null }))
const requestTextInput = vi.hoisted(() => vi.fn())

vi.mock('../../vaultContext', () => ({
  useVault: () => ({
    ...vaultActions,
    state: {
      vault: { root: { id: vaultScope.activeVaultId } },
      vaultCollection: vaultState.collection,
    },
  }),
}))

vi.mock('../../components/TextInputDialogProvider', () => ({
  useTextInputDialog: () => requestTextInput,
}))

import { VaultSelector } from './VaultSelector'
import { VaultSelectorList } from './VaultSelectorList'

const collection: VaultCollectionSnapshot = {
  revision: 4,
  activeVaultId: 'vault-personal',
  vaults: [
    {
      id: 'vault-personal',
      name: 'Personal',
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
      archived: false,
    },
    {
      id: 'vault-work',
      name: 'Work',
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
      archived: false,
    },
    {
      id: 'vault-archive',
      name: 'Archive',
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
      archived: true,
    },
  ],
}

describe('VaultSelectorList', () => {
  it('nests the loaded folder tree only beneath the active top-level vault', () => {
    const html = renderToStaticMarkup(
      <VaultSelectorList
        collection={collection}
        pendingVaultId={null}
        activeContent={<div data-vault-tree='active'>Active vault folders</div>}
        onCreate={(): void => undefined}
        onSwitch={(): void => undefined}
        onRename={(): void => undefined}
        onSetArchived={(): void => undefined}
        onDelete={(): void => undefined}
      />,
    )

    const activeNodeStart = html.indexOf('data-vault-id="vault-personal"')
    const workNodeStart = html.indexOf('data-vault-id="vault-work"')
    const activeTreeStart = html.indexOf('data-vault-tree="active"')

    expect(activeNodeStart).toBeGreaterThan(-1)
    expect(workNodeStart).toBeGreaterThan(activeNodeStart)
    expect(activeTreeStart).toBeGreaterThan(activeNodeStart)
    expect(activeTreeStart).toBeLessThan(workNodeStart)
    expect(html).toContain('data-vault-content-for="vault-personal"')
    expect(html).not.toContain('Manage vaults')
  })

  it('renders active and archived states with bounded management actions', () => {
    const html = renderToStaticMarkup(
      <VaultSelectorList
        collection={collection}
        pendingVaultId={null}
        onCreate={(): void => undefined}
        onSwitch={(): void => undefined}
        onRename={(): void => undefined}
        onSetArchived={(): void => undefined}
        onDelete={(): void => undefined}
      />,
    )

    expect(html).toContain('aria-current="true"')
    expect(html).toContain('data-vault-id="vault-personal"')
    expect(html).toContain('data-vault-id="vault-work"')
    expect(html).toContain('data-vault-id="vault-archive"')
    expect(html).toContain('data-vault-action="create"')
    expect(html).toContain('data-vault-action="archive"')
    expect(html).toContain('data-vault-action="restore"')
    expect(html).toContain('data-vault-action="delete"')
  })

  it('locks every selector choice and action while a vault operation is pending', () => {
    const html = renderToStaticMarkup(
      <VaultSelectorList
        collection={collection}
        pendingVaultId='vault-work'
        onCreate={(): void => undefined}
        onSwitch={(): void => undefined}
        onRename={(): void => undefined}
        onSetArchived={(): void => undefined}
        onDelete={(): void => undefined}
      />,
    )

    expect(html).toMatch(/data-vault-action="create"[^>]*disabled/)
    expect(html.match(/data-vault-action="switch"[^>]*disabled/g)).toHaveLength(3)
    expect(html.match(/data-vault-action="rename"[^>]*disabled/g)).toHaveLength(3)
    expect(html.match(/data-vault-action="(?:archive|restore|delete)"[^>]*disabled/g)).toHaveLength(3)
  })
})

let root: Root | undefined
let rootElement: StubElement

beforeAll(() => {
  rootElement = installRendererDom().root
})

beforeEach(() => {
  vaultScope.activeVaultId = 'vault-personal'
  vaultState.collection = collection
  vaultActions.listVaults.mockResolvedValue(collection)
  vaultActions.createVault.mockResolvedValue(collection)
  vaultActions.switchVault.mockImplementation(async (vaultId: string) => {
    vaultScope.activeVaultId = vaultId
    vaultState.collection = { ...collection, activeVaultId: vaultId }
    return vaultState.collection
  })
  requestTextInput.mockResolvedValue('New vault')
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  rootElement.childNodes.splice(0)
  vi.clearAllMocks()
})

describe('VaultSelector', () => {
  it('opens the active root locally without issuing another vault switch', async () => {
    const onOpen = vi.fn()
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(VaultSelector, {
        activeVaultRoot: {
          canAcceptDrop: false,
          dropInside: false,
          onOpen,
          onDragEnter: vi.fn(),
          onDragOver: vi.fn(),
          onDrop: vi.fn(),
        },
      }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      click(rootElement, requireElement(findButtonByAttribute(rootElement, 'data-vault-id', 'vault-personal')))
      await Promise.resolve()
    })

    expect(onOpen).toHaveBeenCalledOnce()
    expect(vaultActions.switchVault).not.toHaveBeenCalled()
  })

  it('keeps the active vault row as the root drag-and-drop target', async () => {
    const onDragEnter = vi.fn()
    const onDragOver = vi.fn()
    const onDrop = vi.fn()
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(VaultSelectorList, {
        collection,
        pendingVaultId: null,
        activeVaultRoot: {
          canAcceptDrop: true,
          dropInside: true,
          onOpen: vi.fn(),
          onDragEnter,
          onDragOver,
          onDrop,
        },
        onCreate: vi.fn(),
        onSwitch: vi.fn(),
        onRename: vi.fn(),
        onSetArchived: vi.fn(),
        onDelete: vi.fn(),
      }))
      await Promise.resolve()
    })

    const activeButton = requireElement(findButtonByAttribute(rootElement, 'data-vault-id', 'vault-personal'))
    expect(activeButton.getAttribute('data-vault-root-drop')).toBe('enabled')
    expect(activeButton.getAttribute('data-vault-root-drop-active')).toBe('true')
    await act(async () => {
      dispatchEventAt(rootElement, activeButton, 'dragenter')
      dispatchEventAt(rootElement, activeButton, 'dragover')
      dispatchEventAt(rootElement, activeButton, 'drop')
    })

    expect(onDragEnter).toHaveBeenCalledOnce()
    expect(onDragOver).toHaveBeenCalledOnce()
    expect(onDrop).toHaveBeenCalledOnce()
  })

  it('renders the latest context collection after a same-root stale-response recovery', async () => {
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(VaultSelector))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(rootElement.textContent).toContain('Personal')

    vaultState.collection = {
      ...collection,
      revision: collection.revision + 1,
      vaults: collection.vaults.map(vault => vault.id === 'vault-personal'
        ? { ...vault, name: 'Personal latest' }
        : vault),
    }
    await act(async () => {
      root?.render(createElement(VaultSelector))
      await Promise.resolve()
    })

    expect(rootElement.textContent).toContain('Personal latest')
  })

  it('moves the nested tree when an inactive vault is selected', async () => {
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(VaultSelector, {
        activeContent: createElement('span', { 'data-vault-tree': 'active' }),
      }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(vaultActions.listVaults).toHaveBeenCalledOnce()
    expect(findByAttribute(rootElement, 'data-vault-content-for', 'vault-personal')).not.toBeNull()

    await act(async () => {
      click(rootElement, requireElement(findButtonByAttribute(rootElement, 'data-vault-id', 'vault-work')))
      await Promise.resolve()
    })

    expect(vaultActions.switchVault).toHaveBeenCalledWith('vault-work')
    expect(findByAttribute(rootElement, 'data-vault-content-for', 'vault-work')).not.toBeNull()
  })

  it('keeps vault creation reachable in the hierarchy header', async () => {
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(VaultSelector))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      click(rootElement, requireElement(findByAttribute(rootElement, 'data-vault-action', 'create')))
      await Promise.resolve()
    })

    expect(vaultActions.createVault).toHaveBeenCalledWith('New vault')
  })
})

function findByAttribute(rootNode: StubElement, name: string, value: string): StubElement | null {
  if (rootNode.getAttribute(name) === value) return rootNode
  for (const child of rootNode.childNodes) {
    if (!(child instanceof StubElement)) continue
    const match = findByAttribute(child, name, value)
    if (match) return match
  }
  return null
}

function requireElement(element: StubElement | null): StubElement {
  if (!element) throw new Error('Missing renderer element')
  return element
}

function findButtonByAttribute(rootNode: StubElement, name: string, value: string): StubElement | null {
  if (rootNode.tagName.toLowerCase() === 'button' && rootNode.getAttribute(name) === value) return rootNode
  for (const child of rootNode.childNodes) {
    if (!(child instanceof StubElement)) continue
    const match = findButtonByAttribute(child, name, value)
    if (match) return match
  }
  return null
}

function dispatchEventAt(rootNode: StubElement, target: StubElement, type: string): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { configurable: true, value: target })
  rootNode.dispatchEvent(event)
}
