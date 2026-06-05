import type { ProviderType } from '../types'

export type ServiceBrandAssetStatus = 'reviewed' | 'source-backed' | 'fallback'

export interface ServiceBrandAsset {
  id: string
  name: string
  shortName: string
  status: ServiceBrandAssetStatus
  sourceUrl?: string
  guidelinesUrl?: string
  tone?: string
}

export const SERVICE_BRAND_ASSETS_REVIEWED_AT = ''
export const SERVICE_BRAND_ASSETS: Record<string, ServiceBrandAsset> = {}

export function serviceBrandAssetForId(serviceId: string): ServiceBrandAsset | null {
  void serviceId
  return null
}

export function serviceBrandAssetForProviderType(type: ProviderType): ServiceBrandAsset {
  return {
    id: type,
    name: type,
    shortName: type.slice(0, 2).toUpperCase(),
    status: 'fallback',
  }
}

export function ServiceBrandIcon({ className }: { className?: string }) {
  return <span aria-hidden className={className} />
}

export function ProviderIcon({ className }: { type: ProviderType; className?: string }) {
  return <span aria-hidden className={className} />
}

export function RoadmapProviderIcon({ className }: {
  providerId: string
  shortName?: string
  className?: string
}) {
  return <span aria-hidden className={className} />
}
