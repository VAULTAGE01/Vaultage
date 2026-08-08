import { Fragment, type ReactNode } from 'react'

/**
 * Delimits renderer-only navigation, modal, and draft state to one vault root.
 * A root-id change intentionally unmounts the complete child workspace.
 */
export function VaultScopeBoundary({
  vaultId,
  children,
}: {
  vaultId: string
  children?: ReactNode
}) {
  return <Fragment key={`vault-scope:${vaultId}`}>{children}</Fragment>
}
