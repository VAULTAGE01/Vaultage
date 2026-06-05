const DEFAULT_FEEDBACK_URL = 'https://vaultage.dev/contact'

export function feedbackUrl(source = 'desktop_settings'): string {
  const configuredUrl = import.meta.env.VITE_FEEDBACK_URL || DEFAULT_FEEDBACK_URL

  try {
    const url = new URL(configuredUrl)
    url.searchParams.set('source', source)
    url.searchParams.set('product', 'vaultage')
    return url.toString()
  } catch {
    return `${DEFAULT_FEEDBACK_URL}?source=${encodeURIComponent(source)}&product=vaultage`
  }
}
