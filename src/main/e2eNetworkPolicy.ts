import { createRequire } from 'module'
import { join } from 'path'

const RENDERER_URL_PATTERNS = [
  'http://*/*',
  'https://*/*',
  'ws://*/*',
  'wss://*/*',
] as const

type NetworkProtocol = 'http' | 'https' | 'ws' | 'wss'

export type E2ENetworkSnapshot = {
  readonly fetch: number
  readonly http: number
  readonly https: number
  readonly net: number
  readonly rendererHttp: number
  readonly rendererHttps: number
  readonly rendererWs: number
  readonly rendererWss: number
  readonly tls: number
  readonly udp: number
  readonly ws: number
  readonly wss: number
}

type MutableE2ENetworkCounters = {
  -readonly [Key in keyof E2ENetworkSnapshot]: E2ENetworkSnapshot[Key]
}

export type E2ENetworkTargets = {
  readonly fetchTarget: object
  readonly webSocketTarget: object
  readonly httpTarget: object
  readonly httpsTarget: object
  readonly netTarget: object
  readonly tlsTarget: object
  readonly datagramSocketTarget: object
}

export interface E2ENetworkPolicy {
  readonly active: boolean
  denyRenderer(url: string): void
  snapshot(): E2ENetworkSnapshot | null
  dispose(): void
}

export type RendererRequestRegistrar = (
  filter: { readonly urls: string[] },
  listener: (
    details: { readonly url: string },
    callback: (result: { readonly cancel: boolean }) => void,
  ) => void,
) => void

export class E2ENetworkBlockedError extends Error {
  readonly name = 'E2ENetworkBlockedError'

  constructor(readonly protocol: string) {
    super(`network disabled during headless E2E (${protocol})`)
  }
}

export class E2ENetworkPolicyInstallError extends Error {
  readonly name = 'E2ENetworkPolicyInstallError'
}

const loadNodeModule = createRequire(join(process.cwd(), 'package.json'))
const datagramModule = requireObject('dgram')
const datagramSocket = Reflect.get(datagramModule, 'Socket')
if (typeof datagramSocket !== 'function') {
  throw new E2ENetworkPolicyInstallError('required network surface is unavailable: Socket')
}
const datagramSocketPrototype: unknown = Reflect.get(datagramSocket, 'prototype')
if (typeof datagramSocketPrototype !== 'object' || datagramSocketPrototype === null) {
  throw new E2ENetworkPolicyInstallError('required network surface is unavailable: Socket.prototype')
}

const DEFAULT_TARGETS: E2ENetworkTargets = {
  fetchTarget: globalThis,
  webSocketTarget: globalThis,
  httpTarget: requireObject('http'),
  httpsTarget: requireObject('https'),
  netTarget: requireObject('net'),
  tlsTarget: requireObject('tls'),
  datagramSocketTarget: datagramSocketPrototype,
}

export function createE2ENetworkPolicy(
  active: boolean,
  targets: E2ENetworkTargets = DEFAULT_TARGETS,
): E2ENetworkPolicy {
  if (!active) {
    return {
      active: false,
      denyRenderer: () => undefined,
      snapshot: () => null,
      dispose: () => undefined,
    }
  }

  const counters: MutableE2ENetworkCounters = {
    fetch: 0,
    http: 0,
    https: 0,
    net: 0,
    rendererHttp: 0,
    rendererHttps: 0,
    rendererWs: 0,
    rendererWss: 0,
    tls: 0,
    udp: 0,
    ws: 0,
    wss: 0,
  }
  const restorers: Array<() => void> = []
  const increment = (key: keyof E2ENetworkSnapshot): void => {
    counters[key] += 1
  }
  const deny = (key: keyof E2ENetworkSnapshot, protocol: string): never => {
    increment(key)
    throw new E2ENetworkBlockedError(protocol)
  }

  replaceFunction(targets.fetchTarget, 'fetch', (input: unknown) => {
    increment('fetch')
    const protocol = protocolFromInput(input)
    if (protocol === 'http') increment('http')
    if (protocol === 'https') increment('https')
    return Promise.reject(new E2ENetworkBlockedError(protocol ?? 'fetch'))
  }, restorers)
  replaceFunction(targets.webSocketTarget, 'WebSocket', function blockedWebSocket(input: unknown) {
    const protocol = protocolFromInput(input) === 'wss' ? 'wss' : 'ws'
    return deny(protocol, protocol)
  }, restorers)
  replaceFunction(targets.httpTarget, 'request', () => deny('http', 'http'), restorers)
  replaceFunction(targets.httpTarget, 'get', () => deny('http', 'http'), restorers)
  replaceFunction(targets.httpsTarget, 'request', () => deny('https', 'https'), restorers)
  replaceFunction(targets.httpsTarget, 'get', () => deny('https', 'https'), restorers)
  replaceFunction(targets.netTarget, 'connect', () => deny('net', 'net'), restorers)
  replaceFunction(targets.netTarget, 'createConnection', () => deny('net', 'net'), restorers)
  replaceFunction(targets.tlsTarget, 'connect', () => deny('tls', 'tls'), restorers)
  replaceFunction(targets.datagramSocketTarget, 'connect', () => deny('udp', 'udp'), restorers)
  replaceFunction(targets.datagramSocketTarget, 'send', () => deny('udp', 'udp'), restorers)

  return {
    active: true,
    denyRenderer: url => {
      const protocol = protocolFromInput(url)
      if (protocol === 'http') increment('rendererHttp')
      if (protocol === 'https') increment('rendererHttps')
      if (protocol === 'ws') increment('rendererWs')
      if (protocol === 'wss') increment('rendererWss')
    },
    snapshot: () => ({ ...counters }),
    dispose: () => {
      for (let index = restorers.length - 1; index >= 0; index -= 1) {
        restorers[index]?.()
      }
    },
  }
}

function requireObject(specifier: string): object {
  const value: unknown = loadNodeModule(specifier)
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new E2ENetworkPolicyInstallError(`required network module is unavailable: ${specifier}`)
  }
  return value
}

export function installRendererNetworkDenial(
  register: RendererRequestRegistrar,
  policy: E2ENetworkPolicy,
): void {
  if (!policy.active) return
  register({ urls: [...RENDERER_URL_PATTERNS] }, (details, callback) => {
    policy.denyRenderer(details.url)
    callback({ cancel: true })
  })
}

function replaceFunction(
  target: object,
  key: PropertyKey,
  replacement: (...args: readonly unknown[]) => unknown,
  restorers: Array<() => void>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new E2ENetworkPolicyInstallError(`required network surface is unavailable: ${String(key)}`)
  }
  Object.defineProperty(target, key, { ...descriptor, value: replacement })
  restorers.push(() => {
    Object.defineProperty(target, key, descriptor)
  })
}

function protocolFromInput(input: unknown): NetworkProtocol | null {
  let value: string | null = null
  if (typeof input === 'string') value = input
  else if (input instanceof URL) value = input.href
  else if (typeof input === 'object' && input !== null) {
    const candidate: unknown = Reflect.get(input, 'url')
    if (typeof candidate === 'string') value = candidate
  }
  if (!value) return null
  if (value.startsWith('https://')) return 'https'
  if (value.startsWith('http://')) return 'http'
  if (value.startsWith('wss://')) return 'wss'
  if (value.startsWith('ws://')) return 'ws'
  return null
}
