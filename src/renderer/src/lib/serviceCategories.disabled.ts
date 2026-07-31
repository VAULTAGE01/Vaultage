import type { ProviderType } from '../types'

export type ServiceCategoryId =
  | 'build'
  | 'ai'
  | 'code'
  | 'backend'
  | 'backend-cloud'
  | 'cloud-secrets'
  | 'deploy'
  | 'secure'
  | 'connect'
  | 'observe'
  | 'monetize'

export interface ServiceCategory {
  id: ServiceCategoryId
  label: string
  pageTitle: string
  description: string
  plannedCount: number
  catalogCount: number
}

export const SERVICE_CATEGORIES: ServiceCategory[] = []
export const PROVIDER_TYPE_CATEGORY: Partial<Record<ProviderType, ServiceCategoryId>> = {}
export const CLOUD_SECRET_MANAGER_PROVIDER_TYPES: readonly ProviderType[] = []

export function serviceCategoryLabel(categoryId: ServiceCategoryId): string {
  return categoryId
}

export function serviceCountByCategory(categoryId: ServiceCategoryId): number {
  void categoryId
  return 0
}

export function providerTypeCategory(type: ProviderType): ServiceCategoryId | null {
  void type
  return null
}

export function providerTypeBelongsToCategory(
  type: ProviderType,
  categoryId: ServiceCategoryId,
): boolean {
  void type
  void categoryId
  return false
}
