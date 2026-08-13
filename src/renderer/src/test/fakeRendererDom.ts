type StubListener = (event: Event) => void

export class StubNode {
  readonly childNodes: StubNode[] = []
  parentNode: StubNode | null = null
  readonly listeners = new Map<string, Set<StubListener>>()

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: StubDocument | null,
  ) {}

  get textContent(): string | null {
    return this.childNodes.map(child => child.textContent ?? '').join('')
  }

  get firstChild(): StubNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): StubNode | null {
    const index = this.parentNode?.childNodes.indexOf(this) ?? -1
    return index >= 0 ? this.parentNode?.childNodes[index + 1] ?? null : null
  }

  appendChild(child: StubNode): StubNode {
    this.childNodes.push(child)
    child.parentNode = this
    return child
  }

  insertBefore(child: StubNode, before: StubNode | null): StubNode {
    if (!before) return this.appendChild(child)
    const index = this.childNodes.indexOf(before)
    if (index < 0) return this.appendChild(child)
    this.childNodes.splice(index, 0, child)
    child.parentNode = this
    return child
  }

  removeChild(child: StubNode): StubNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  addEventListener(type: string, listener: StubListener): void {
    const listeners = this.listeners.get(type) ?? new Set<StubListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: StubListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    this.listeners.get(event.type)?.forEach(listener => listener(event))
    return true
  }

  contains(node: StubNode | null): boolean {
    if (node === this) return true
    return this.childNodes.some(child => child.contains(node))
  }
}

export class StubText extends StubNode {
  constructor(readonly data: string, document: StubDocument) {
    super(3, '#text', document)
  }

  get textContent(): string {
    return this.data
  }
}

export class StubElement extends StubNode {
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = {}
  value = ''

  constructor(
    readonly tagName: string,
    document: StubDocument,
  ) {
    super(1, tagName.toUpperCase(), document)
  }

  get textContent(): string {
    return this.childNodes.map(child => child.textContent ?? '').join('')
  }

  set textContent(value: string) {
    this.childNodes.splice(0)
    if (value) {
      const document = this.ownerDocument
      if (!document) throw new TypeError('Stub element has no owner document')
      this.appendChild(new StubText(value, document))
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  focus(): void {
    const document = this.ownerDocument
    if (!document) throw new TypeError('Stub element has no owner document')
    document.activeElement = this
  }

  blur(): void {
    const document = this.ownerDocument
    if (!document) throw new TypeError('Stub element has no owner document')
    if (document.activeElement === this) document.activeElement = document.body
  }
}

export class StubDocument extends StubNode {
  readonly body: StubElement
  readonly head: StubElement
  readonly documentElement: StubElement
  activeElement: StubElement
  defaultView: StubRendererWindow | null = null

  constructor() {
    super(9, '#document', null)
    this.head = new StubElement('head', this)
    this.body = new StubElement('body', this)
    this.documentElement = new StubElement('html', this)
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.activeElement = this.body
  }

  createElement(tagName: string): StubElement {
    return new StubElement(tagName, this)
  }

  createElementNS(_namespace: string, tagName: string): StubElement {
    return this.createElement(tagName)
  }

  createTextNode(value: string): StubText {
    return new StubText(value, this)
  }

  getElementsByTagName(tagName: string): StubElement[] {
    const matches: StubElement[] = []
    const visit = (node: StubNode): void => {
      for (const child of node.childNodes) {
        if (child instanceof StubElement && (tagName === '*' || child.tagName.toLowerCase() === tagName.toLowerCase())) {
          matches.push(child)
        }
        visit(child)
      }
    }
    visit(this.documentElement)
    return matches
  }
}

export type StubRendererWindow = {
  readonly document: StubDocument
  readonly navigator: { readonly userAgent: string }
  readonly location: { readonly protocol: string }
  readonly getComputedStyle: (element: Element) => Pick<CSSStyleDeclaration, 'animationDelay' | 'animationDuration' | 'animationName' | 'display'>
  readonly setTimeout: typeof setTimeout
  readonly clearTimeout: typeof clearTimeout
  readonly requestAnimationFrame: typeof requestAnimationFrame
  readonly cancelAnimationFrame: typeof cancelAnimationFrame
  readonly HTMLIFrameElement: typeof StubElement
  vault?: unknown
}

export function installRendererDom(): { readonly window: StubRendererWindow; readonly root: StubElement } {
  const document = new StubDocument()
  const getComputedStyle = (): Pick<CSSStyleDeclaration, 'animationDelay' | 'animationDuration' | 'animationName' | 'display'> => ({
    animationDelay: '0s',
    animationDuration: '0s',
    animationName: 'none',
    display: 'block',
  })
  const requestAnimationFrame: typeof globalThis.requestAnimationFrame = callback => {
    callback(performance.now())
    return 0
  }
  const cancelAnimationFrame: typeof globalThis.cancelAnimationFrame = () => undefined
  const window: StubRendererWindow = {
    document,
    navigator: { userAgent: 'vitest' },
    location: { protocol: 'http:' },
    getComputedStyle,
    setTimeout,
    clearTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,
    HTMLIFrameElement: StubElement,
  }
  document.defaultView = window
  Object.assign(globalThis, {
    window,
    document,
    self: window,
    Node: StubNode,
    Element: StubElement,
    HTMLElement: StubElement,
    SVGElement: StubElement,
    HTMLIFrameElement: StubElement,
    Text: StubText,
    getComputedStyle,
    requestAnimationFrame,
    cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator })
  return { window, root: document.createElement('div') }
}

export function click(root: StubElement, target: StubElement): void {
  const event = new Event('click', { bubbles: true })
  Object.defineProperty(event, 'target', { configurable: true, value: target })
  root.dispatchEvent(event)
}
