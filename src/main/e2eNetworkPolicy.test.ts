import { createRequire } from 'module'
import { createServer } from 'net'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  E2ENetworkBlockedError,
  createE2ENetworkPolicy,
  installRendererNetworkDenial,
  type E2ENetworkTargets,
  type RendererRequestRegistrar,
} from './e2eNetworkPolicy'

function callable(target: object, key: PropertyKey): (...args: readonly unknown[]) => unknown {
  const value: unknown = Reflect.get(target, key)
  if (typeof value !== 'function') throw new TypeError(`Expected ${String(key)} to be callable`)
  return (...args: readonly unknown[]) => Reflect.apply(value, target, args)
}

function networkTargets(): {
  readonly targets: E2ENetworkTargets
  readonly originals: readonly ReturnType<typeof vi.fn>[]
} {
  const originals = Array.from({ length: 12 }, () => vi.fn())
  return {
    targets: {
      fetchTarget: { fetch: originals[0] },
      webSocketTarget: { WebSocket: originals[1] },
      httpTarget: { request: originals[2], get: originals[3] },
      httpsTarget: { request: originals[4], get: originals[5] },
      netTarget: { connect: originals[6], createConnection: originals[7] },
      tlsTarget: { connect: originals[8] },
      datagramSocketTarget: { connect: originals[9], send: originals[10] },
    },
    originals,
  }
}

describe('Electron E2E network policy', () => {
  it('denies every main-process transport without invoking the original functions', async () => {
    // Given
    const fixture = networkTargets()
    const policy = createE2ENetworkPolicy(true, fixture.targets)

    // When / Then
    await expect(callable(fixture.targets.fetchTarget, 'fetch')('http://127.0.0.1:1'))
      .rejects.toBeInstanceOf(E2ENetworkBlockedError)
    const webSocketConstructor: unknown = Reflect.get(fixture.targets.webSocketTarget, 'WebSocket')
    if (typeof webSocketConstructor !== 'function') throw new TypeError('WebSocket fixture is unavailable')
    expect(() => Reflect.construct(webSocketConstructor, ['wss://127.0.0.1:1']))
      .toThrowError(E2ENetworkBlockedError)
    for (const [target, key] of [
      [fixture.targets.httpTarget, 'request'],
      [fixture.targets.httpTarget, 'get'],
      [fixture.targets.httpsTarget, 'request'],
      [fixture.targets.httpsTarget, 'get'],
      [fixture.targets.netTarget, 'connect'],
      [fixture.targets.netTarget, 'createConnection'],
      [fixture.targets.tlsTarget, 'connect'],
      [fixture.targets.datagramSocketTarget, 'connect'],
      [fixture.targets.datagramSocketTarget, 'send'],
    ] as const) {
      expect(() => callable(target, key)()).toThrowError(E2ENetworkBlockedError)
    }
    expect(fixture.originals.every(original => original.mock.calls.length === 0)).toBe(true)
    expect(policy.snapshot()).toMatchObject({
      fetch: 1,
      http: 3,
      https: 2,
      net: 2,
      tls: 1,
      udp: 2,
      ws: 0,
      wss: 1,
    })
    policy.dispose()
  })

  it('cancels renderer HTTP, HTTPS, WS, and WSS before a request can leave the session', () => {
    // Given
    const fixture = networkTargets()
    const policy = createE2ENetworkPolicy(true, fixture.targets)
    const listeners: Parameters<RendererRequestRegistrar>[1][] = []
    const register: RendererRequestRegistrar = (_filter, candidate) => { listeners.push(candidate) }
    installRendererNetworkDenial(register, policy)
    const listener = listeners[0]
    if (!listener) throw new TypeError('Renderer denial listener was not registered')

    // When
    const cancellations: boolean[] = []
    for (const url of [
      'http://127.0.0.1:41001/probe',
      'https://127.0.0.1:41002/probe',
      'ws://127.0.0.1:41003/probe',
      'wss://127.0.0.1:41004/probe',
    ]) {
      listener({ url }, result => cancellations.push(result.cancel))
    }

    // Then
    expect(cancellations).toEqual([true, true, true, true])
    expect(policy.snapshot()).toMatchObject({
      rendererHttp: 1,
      rendererHttps: 1,
      rendererWs: 1,
      rendererWss: 1,
    })
    policy.dispose()
  })

  it('does not install any denial for a packaged-policy fixture', () => {
    // Given
    const fixture = networkTargets()

    // When
    const policy = createE2ENetworkPolicy(false, fixture.targets)
    callable(fixture.targets.httpTarget, 'request')()

    // Then
    const originalRequest = fixture.originals[2]
    if (!originalRequest) throw new TypeError('HTTP request fixture is unavailable')
    expect(originalRequest).toHaveBeenCalledOnce()
    expect(policy.snapshot()).toBeNull()
  })

  it('keeps an active loopback HTTP sentinel at zero accepted sockets', async () => {
    // Given
    let accepted = 0
    let markAccepted: () => void = () => undefined
    const acceptedConnection = new Promise<void>(resolve => { markAccepted = resolve })
    const server = createServer(socket => {
      accepted += 1
      socket.destroy()
      markAccepted()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new TypeError('HTTP sentinel address is unavailable')
    const httpModule: unknown = createRequire(join(process.cwd(), 'package.json'))('http')
    if (typeof httpModule !== 'object' || httpModule === null) {
      throw new TypeError('HTTP module is unavailable')
    }
    const policy = createE2ENetworkPolicy(true)
    let request: unknown = null
    let blocked = false
    try {
      // When
      try {
        request = callable(httpModule, 'get')(`http://127.0.0.1:${address.port}/probe`)
      } catch (error) {
        if (!(error instanceof E2ENetworkBlockedError)) throw error
        blocked = true
      }
      if (typeof request === 'object' && request !== null) {
        const onError: unknown = Reflect.get(request, 'on')
        if (typeof onError === 'function') Reflect.apply(onError, request, ['error', () => undefined])
      }
      await Promise.race([
        acceptedConnection,
        new Promise<void>(resolve => { setTimeout(resolve, 150) }),
      ])

      // Then
      expect({ accepted, blocked }).toEqual({ accepted: 0, blocked: true })
    } finally {
      policy.dispose()
      if (typeof request === 'object' && request !== null) {
        const destroy: unknown = Reflect.get(request, 'destroy')
        if (typeof destroy === 'function') Reflect.apply(destroy, request, [])
      }
      await new Promise<void>((resolve, reject) => {
        server.close(error => { if (error) reject(error); else resolve() })
      })
    }
  })
})
