export async function writeAgentDiscovery(_token: string, _port: number, _listenerId: string, _startedAt: string): Promise<void> {
  // Community edition does not expose the private Agent/browser bridge.
}

export async function removeAgentDiscovery(): Promise<void> {
  // Community edition has no private Agent discovery record.
}
