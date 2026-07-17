const ALLOWED_EXTERNAL_URL_HOSTS = new Set([
  'vaultage.dev',
  'www.vaultage.dev',
  'dash.cloudflare.com',
  'github.com',
  'gitlab.com',
  'vercel.com',
  'dashboard.doppler.com',
  'console.aws.amazon.com',
  'console.cloud.google.com',
  'console.firebase.google.com',
  'portal.azure.com',
  'platform.openai.com',
  'supabase.com',
  'app.netlify.com',
  'console.twilio.com',
  'resend.com',
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
