export interface CommercialCapabilities {
  agent: boolean
  services: boolean
  extension: boolean
}

/** Community feature surfaces are controlled by their existing disabled aliases. */
export function useCommercialCapabilities(): CommercialCapabilities {
  return { agent: false, services: false, extension: false }
}
