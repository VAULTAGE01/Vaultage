export interface SecretFormAuthorship {
  secretId: string | null
  revision: number
}

export function captureSecretFormAuthorship(
  existing: Readonly<{ id: string }> | undefined,
  vaultRevision: number | undefined,
): Readonly<SecretFormAuthorship> {
  return Object.freeze({
    secretId: existing?.id ?? null,
    revision: vaultRevision ?? 1,
  })
}

export function authoredRevisionForSecretUpdate(
  authorship: Readonly<SecretFormAuthorship>,
  secretId: string,
): number {
  if (authorship.secretId !== secretId) {
    throw new Error('Secret edit target changed; close and reopen the editor')
  }
  return authorship.revision
}

export function secretFormSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Vault changed while this action was pending')) {
    return 'This vault changed after you opened the editor. Your draft was not saved. Close and reopen the editor before retrying.'
  }
  return message || 'Could not save this secret'
}
