const ALLOWED_EXTERNAL_URL_HOSTS = new Set([
  'vaultage.dev',
  'www.vaultage.dev',
  'dash.cloudflare.com',
  'vercel.com',
  'dashboard.doppler.com',
])

export function resolveAllowedExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (!ALLOWED_EXTERNAL_URL_HOSTS.has(url.hostname.toLowerCase())) return null

  return url.toString()
}
