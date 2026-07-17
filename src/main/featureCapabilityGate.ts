import type { CommercialRuntimeAccess } from '#commercial-runtime'
import type { ExtensionHandoff } from '#extension-handoff'

/** Keeps signed protocol parsing separate from commercial authorization. */
export async function authorizeCommercialExtensionHandoff(
  runtime: Pick<CommercialRuntimeAccess, 'requireCapability'> | null,
  handoff: ExtensionHandoff | null,
): Promise<ExtensionHandoff | null> {
  if (!runtime || !handoff) return null
  try {
    await runtime.requireCapability('pro.extension')
    return handoff
  } catch {
    return null
  }
}
