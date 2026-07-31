const MAX_URL_BYTES = 512
const RETURN_URL_RE = /^vaultage:\/\/billing\/checkout\/(returned|cancelled)\?state=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

export interface HostedBillingReturn {
  readonly kind: 'checkout'
  readonly outcome: 'returned' | 'cancelled'
  /** Opaque, main-generated correlation. It never crosses Electron IPC. */
  readonly returnToken: string
}

/**
 * Parses only the checkout return protocol. This intentionally does not share
 * the browser-extension parser: the two protocol contracts have different
 * authorities and must not become interchangeable by accident.
 */
export function parseHostedBillingReturnUrl(rawUrl: string): HostedBillingReturn | null {
  if (Buffer.byteLength(rawUrl, 'utf8') > MAX_URL_BYTES) return null
  const match = RETURN_URL_RE.exec(rawUrl)
  if (!match) return null
  const [, outcome, returnToken] = match
  if ((outcome !== 'returned' && outcome !== 'cancelled') || !returnToken) return null
  return {
    kind: 'checkout',
    outcome,
    returnToken,
  }
}

export function findHostedBillingReturnArg(argv: readonly string[]): HostedBillingReturn | null {
  for (const arg of argv) {
    const billingReturn = parseHostedBillingReturnUrl(arg)
    if (billingReturn) return billingReturn
  }
  return null
}
