import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  click,
  installRendererDom,
  StubElement,
  StubNode,
  type StubRendererWindow,
} from '../test/fakeRendererDom'

const vaultContext = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('../vaultContext', () => ({
  useVault: () => vaultContext.value,
}))

import EnvProjectsModal from './EnvProjectsModal'

let rendererWindow: StubRendererWindow
let rootElement: StubElement
let root: Root | undefined

beforeAll(() => {
  const installed = installRendererDom()
  rendererWindow = installed.window
  rootElement = installed.root
})

beforeEach(() => {
  vaultContext.value = {
    state: {
      vault: {
        envProjects: [],
        providers: [],
        preferences: {},
        root: { id: 'root', name: 'Vault', children: [], secrets: [] },
      },
    },
    addEnvProject: vi.fn(),
    updateEnvProject: vi.fn(),
    deleteEnvProject: vi.fn(),
    setPreferences: vi.fn(),
  }
  Object.assign(rendererWindow, {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  rendererWindow.vault = {
    pickFolder: vi.fn(async () => '/workspace'),
    discoverProjects: vi.fn(async () => ({
      success: true,
      result: {
        parentPath: '/workspace',
        scannedAt: '2026-08-01T00:00:00.000Z',
        candidates: Array.from({ length: 12 }, (_, index) => ({
          path: `/workspace/candidate-${index + 1}`,
          name: `Candidate ${index + 1}`,
          envKeyCount: index + 1,
          envFileCount: 1,
          serviceCount: 1,
          services: ['Stripe'],
          projectTypes: ['Vite'],
          scannedFileCount: 2,
          warningCount: 0,
        })),
        warnings: [],
      },
    })),
  }
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = undefined
  }
  rendererWindow.document.body.childNodes.splice(0)
})

describe('EnvProjectsModal mobile project discovery layout', () => {
  it('keeps a populated candidate list in its bounded scroll region while Review remains mounted', async () => {
    root = createRoot(rootElement as unknown as Element)
    await act(async () => {
      root?.render(createElement(EnvProjectsModal, { onClose: vi.fn(), startNew: true }))
    })

    await act(async () => {
      click(rendererWindow.document.body, findButton(rendererWindow.document.body, 'Choose Parent'))
      await Promise.resolve()
      await Promise.resolve()
    })

    const candidateRegion = findElementByAriaLabel(rendererWindow.document.body, 'Discovered project candidates')
    const review = findElementByAriaLabel(rendererWindow.document.body, 'Project review')
    const mobileGrid = candidateRegion.parentNode?.parentNode

    expect(candidateRegion.textContent).toContain('Candidate 1')
    expect(candidateRegion.textContent).toContain('Candidate 12')
    expect(candidateRegion.textContent?.match(/Candidate \d+/g)).toHaveLength(12)
    expect(candidateRegion.getAttribute('class')).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain')
    expect(review.textContent).toContain('No local folder attached')
    expect(review.getAttribute('class')).toContain('min-h-0 flex-col overflow-hidden')
    expect(mobileGrid).toBeInstanceOf(StubElement)
    expect((mobileGrid as StubElement).getAttribute('class')).toContain('grid-rows-[minmax(12rem,52%)_minmax(0,1fr)]')
  })
})

function findButton(root: StubNode, label: string): StubElement {
  const button = findElement(root, node => node.tagName.toLowerCase() === 'button' && node.textContent?.includes(label))
  if (!button) throw new Error(`Missing button: ${label}`)
  return button
}

function findElementByAriaLabel(root: StubNode, label: string): StubElement {
  const element = findElement(root, node => node.getAttribute('aria-label') === label)
  if (!element) throw new Error(`Missing region: ${label}`)
  return element
}

function findElement(root: StubNode, predicate: (node: StubElement) => boolean): StubElement | null {
  for (const child of root.childNodes) {
    if (child instanceof StubElement && predicate(child)) return child
    const nested = findElement(child, predicate)
    if (nested) return nested
  }
  return null
}
