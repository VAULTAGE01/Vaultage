import type { ElementType } from 'react'
import type { ServiceCategoryId } from '#service-categories'

export const SERVICE_CATEGORY_ICONS: Partial<Record<ServiceCategoryId, ElementType>> = {}

export function ServiceCategoryIcon({ className }: { categoryId: ServiceCategoryId; className?: string }) {
  return <span aria-hidden className={className} />
}
