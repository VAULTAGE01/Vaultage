import { createServer, type Server } from 'net'

export const COMMUNITY_POLICY_PROTOCOLS = ['http', 'https', 'ws', 'wss'] as const
export type CommunityPolicyProtocol = (typeof COMMUNITY_POLICY_PROTOCOLS)[number]

export type CommunityPolicySentinel = {
  readonly url: string
  readonly accepted: () => number
  readonly close: () => Promise<void>
}

async function listenLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => { if (error) reject(error); else resolveClose() })
  })
}

export async function startCommunityPolicySentinel(
  protocol: CommunityPolicyProtocol,
): Promise<CommunityPolicySentinel> {
  let accepted = 0
  const server = createServer(socket => {
    accepted += 1
    socket.destroy()
  })
  try {
    await listenLoopback(server)
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new TypeError('Loopback sentinel has no TCP address')
    }
    return {
      url: `${protocol}://127.0.0.1:${address.port}/probe`,
      accepted: () => accepted,
      close: async () => await closeServer(server),
    }
  } catch (error) {
    if (server.listening) await closeServer(server)
    throw error
  }
}
