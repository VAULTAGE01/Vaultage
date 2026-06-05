import type { VaultSecret } from '../types'

export const PINNED_SECRET_TAG = 'pinned'

const PIN_TAGS = new Set(['pin', 'pinned', 'favorite', 'favourite', 'starred'])

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
