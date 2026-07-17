import type { VaultSecret } from '../types'

export const PINNED_SECRET_TAG = 'pinned'

const PIN_TAGS = new Set(['pin', 'pinned', 'favorite', 'favourite', 'starred'])

export type PinTargetKind = 'secret' | 'project' | 'service'

export function pinTargetId(kind: PinTargetKind, id: string): string {
  return `${kind}:${id}`
}

export function pinTargetAliases(kind: PinTargetKind, id: string): string[] {
  const canonical = pinTargetId(kind, id)
  return kind === 'secret' ? [canonical, id] : [canonical]
}

export function isPinnedTarget(
  savedPinnedOrder: readonly string[] | undefined,
  kind: PinTargetKind,
  id: string,
): boolean {
  const order = savedPinnedOrder ?? []
  return pinTargetAliases(kind, id).some(alias => order.includes(alias))
}

export function setPinnedTargetOrder(
  savedPinnedOrder: readonly string[] | undefined,
  kind: PinTargetKind,
  id: string,
  pinned: boolean,
): string[] {
  const aliases = new Set(pinTargetAliases(kind, id))
  const next = (savedPinnedOrder ?? []).filter(item => !aliases.has(item))
  return pinned ? [...next, pinTargetId(kind, id)] : next
}

export function togglePinnedTargetOrder(
  savedPinnedOrder: readonly string[] | undefined,
  kind: PinTargetKind,
  id: string,
): string[] {
  return setPinnedTargetOrder(
    savedPinnedOrder,
    kind,
    id,
    !isPinnedTarget(savedPinnedOrder, kind, id),
  )
}

export function isPinnedSecret(secret: Pick<VaultSecret, 'tags'>): boolean {
  return (secret.tags ?? []).some(tag => PIN_TAGS.has(tag.trim().toLowerCase()))
}

export function setPinnedSecret(secret: VaultSecret, pinned: boolean): VaultSecret {
  if (pinned) {
    return isPinnedSecret(secret)
      ? secret
      : { ...secret, tags: [...(secret.tags ?? []), PINNED_SECRET_TAG] }
  }

  const tags = (secret.tags ?? []).filter(tag => !PIN_TAGS.has(tag.trim().toLowerCase()))
  return { ...secret, tags: tags.length ? tags : undefined }
}

export function togglePinnedSecret(secret: VaultSecret): VaultSecret {
  return setPinnedSecret(secret, !isPinnedSecret(secret))
}
