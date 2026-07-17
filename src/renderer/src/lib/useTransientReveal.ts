import { useCallback, useEffect, useRef, useState } from 'react'

export const TRANSIENT_REVEAL_TTL_MS = 30_000

export type TransientRevealOutcome = 'revealed' | 'empty' | 'stale'

type RevealedValue<T> = {
  identity: string
  value: T
}

export class TransientRevealGate {
  private generation = 0

  begin(identity: string) {
    return { identity, generation: ++this.generation }
  }

  invalidate() {
    this.generation += 1
  }

  isCurrent(attempt: { identity: string; generation: number }, identity: string) {
    return attempt.identity === identity && attempt.generation === this.generation
  }
}

export function maskTransientReveal(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  mask: () => void,
) {
  if (timerRef.current) clearTimeout(timerRef.current)
  timerRef.current = null
  mask()
}

/** Keeps decrypted renderer values short-lived and tied to one exact secret/field identity. */
export function useTransientReveal<T>(identity: string, ttlMs = TRANSIENT_REVEAL_TTL_MS) {
  const [revealed, setRevealed] = useState<RevealedValue<T> | null>(null)
  const identityRef = useRef(identity)
  const gateRef = useRef(new TransientRevealGate())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Mask a value synchronously when React reuses this component for another item.
  if (identityRef.current !== identity) {
    identityRef.current = identity
    gateRef.current.invalidate()
  }

  const mask = useCallback(() => {
    maskTransientReveal(timerRef, () => setRevealed(null))
  }, [])

  const clear = useCallback(() => {
    gateRef.current.invalidate()
    mask()
  }, [mask])

  useEffect(() => {
    clear()
  }, [identity, clear])

  useEffect(() => {
    mountedRef.current = true
    const clearWhenHidden = () => {
      if (document.visibilityState === 'hidden') clear()
    }
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clearWhenHidden)
    return () => {
      mountedRef.current = false
      gateRef.current.invalidate()
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clearWhenHidden)
    }
  }, [clear])

  const reveal = useCallback(async (resolve: () => Promise<T | null>): Promise<TransientRevealOutcome> => {
    // A re-arm must mask the previous plaintext before awaiting the next authorization/result.
    // Otherwise the new generation invalidates the old expiry timer while leaving its value visible.
    mask()
    const requestedIdentity = identityRef.current
    const attempt = gateRef.current.begin(requestedIdentity)
    const value = await resolve()
    if (
      !mountedRef.current
      || value === null
      || !gateRef.current.isCurrent(attempt, identityRef.current)
      || document.visibilityState === 'hidden'
    ) {
      return value === null && gateRef.current.isCurrent(attempt, identityRef.current) ? 'empty' : 'stale'
    }

    setRevealed({ identity: requestedIdentity, value })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (gateRef.current.isCurrent(attempt, identityRef.current)) clear()
    }, ttlMs)
    return 'revealed'
  }, [clear, mask, ttlMs])

  const value = revealed?.identity === identity ? revealed.value : null
  return { clear, reveal, value, isRevealed: value !== null }
}
