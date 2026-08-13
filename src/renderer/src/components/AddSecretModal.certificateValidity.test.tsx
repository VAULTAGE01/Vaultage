import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultRoot, VaultSecret } from '../types'
import {
  click,
  installRendererDom,
  StubElement,
  type StubNode,
  type StubRendererWindow,
} from '../test/fakeRendererDom'

const vaultContext = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('../vaultContext', () => ({
  useVault: () => vaultContext.value,
}))

vi.mock('#commercial-capabilities', () => ({
  useCommercialCapabilities: () => ({ agent: false, services: false, extension: false }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DialogFooter: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SelectTrigger: ({ children }: { children: ReactNode }) => createElement('button', null, children),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SelectItem: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SelectSeparator: () => null,
}))

vi.mock('./SecretAccessControls', () => ({ default: () => null }))

import AddSecretModal from '#add-secret-modal'

const vault: VaultRoot = {
  version: 2,
  revision: 1,
  root: { id: 'root', name: 'Vault', children: [], secrets: [], itemOrder: [] },
  providers: [],
  providerGroups: [],
  envProjects: [],
}

let rootElement: StubElement
let root: Root | undefined
let rendererWindow: StubRendererWindow
let addSecret: ReturnType<typeof vi.fn>
let updateSecret: ReturnType<typeof vi.fn>

beforeAll(() => {
  const installed = installRendererDom()
  rootElement = installed.root
  rendererWindow = installed.window
})

beforeEach(() => {
  addSecret = vi.fn(async () => undefined)
  updateSecret = vi.fn(async () => undefined)
  vaultContext.value = {
    state: {
      screen: 'unlocked',
      vault,
      selectedFolderId: 'root',
      selectedSecretId: null,
      error: null,
      saving: false,
      justCompletedSetup: false,
    },
    addSecret,
    updateSecret,
  }
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  rootElement.childNodes.splice(0)
})

describe('certificate validity save guard', () => {
  it('refuses a new certificate with only one validity date before creating it', async () => {
    await render(<AddSecretModal folderId="root" defaultType="certificate" onClose={vi.fn()} />)
    await setInput('e.g. GitHub token', 'API client certificate')
    await setInput('certificate-not-before', '2026-08-08')
    await save()

    expect(rootElement.textContent).toContain('Enter both certificate validity dates')
    expect(rendererWindow.document.activeElement.getAttribute('role')).toBe('alert')
    expect(addSecret).not.toHaveBeenCalled()
    expect(updateSecret).not.toHaveBeenCalled()
  })

  it('refuses a certificate edit with only one validity date before updating it', async () => {
    await render(
      <AddSecretModal folderId="root" existing={certificateSecret()} onClose={vi.fn()} />,
    )
    await setInput('certificate-not-after', '2027-08-08')
    await save()

    expect(rootElement.textContent).toContain('Enter both certificate validity dates')
    expect(rendererWindow.document.activeElement.getAttribute('role')).toBe('alert')
    expect(addSecret).not.toHaveBeenCalled()
    expect(updateSecret).not.toHaveBeenCalled()
  })
})

async function render(element: ReturnType<typeof createElement>) {
  root = createRoot(rootElement as unknown as Element)
  await act(async () => root?.render(element))
}

async function setInput(identifier: string, value: string) {
  const input = identifier.includes('certificate-')
    ? findByAttribute(rootElement, 'id', identifier)
    : findByAttribute(rootElement, 'placeholder', identifier)
  if (!input) throw new Error(`Missing input ${identifier}`)
  await act(async () => {
    input.value = value
    Simulate.change(input as unknown as Element, { target: { value } } as never)
  })
}

async function save() {
  const button = findButton(rootElement, 'Save')
  if (!button) throw new Error('Missing Save button')
  await act(async () => click(rootElement, button))
}

function certificateSecret(): VaultSecret {
  return {
    id: 'certificate-1',
    name: 'API client certificate',
    type: 'certificate',
    fields: [{ key: 'Certificate', value: 'stored', sensitive: true }],
    notes: '',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    certificate: { format: 'PEM' },
  }
}

function findButton(node: StubNode, text: string): StubElement | null {
  return findElement(node, element => element.tagName.toLowerCase() === 'button' && element.textContent === text)
}

function findByAttribute(node: StubNode, name: string, value: string): StubElement | null {
  return findElement(node, element => element.getAttribute(name) === value)
}

function findElement(node: StubNode, predicate: (element: StubElement) => boolean): StubElement | null {
  for (const child of node.childNodes) {
    if (child instanceof StubElement && predicate(child)) return child
    const nested = findElement(child, predicate)
    if (nested) return nested
  }
  return null
}
