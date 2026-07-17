import type { ReactNode } from 'react'

export function CommercialAccountProvider({ children }: { children: ReactNode }) {
  return children
}

export function useCommercialAccount(): never {
  throw new Error('Commercial accounts are not available in Vaultage Community')
}
