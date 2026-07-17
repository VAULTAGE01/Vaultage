import type { PreparedSecret } from '../lib/csvImport'

export const IMPORT_VALUE_MASK = '••••••••'

export function importPreviewValueLabel(item: PreparedSecret): string {
  if (item.secret?.type === 'image') return 'Image'
  if (item.secret?.fields.some(field => field.value.length > 0) || item.raw.value) {
    return IMPORT_VALUE_MASK
  }
  return '—'
}

/** Secret values are deliberately never copied into text nodes or attributes. */
export function ImportPreviewValue({ item }: { item: PreparedSecret }) {
  const label = importPreviewValueLabel(item)
  return (
    <span
      className="text-text-secondary font-mono truncate"
      aria-label={label === IMPORT_VALUE_MASK ? 'Secret value hidden' : label}
    >
      {label}
    </span>
  )
}
