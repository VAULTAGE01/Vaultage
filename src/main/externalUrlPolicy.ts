const ALLOWED_EXTERNAL_URL_HOSTS = new Set([
  'vaultage.dev',
  'www.vaultage.dev',
  'dash.cloudflare.com',
  'developers.cloudflare.com',
  'api.slack.com',
  'auth0.com',
  'cloud.google.com',
  'docs-resources.prod.twilio.com',
  'docs.apify.com',
  'docs.railway.com',
  'docs.aws.amazon.com',
  'docs.github.com',
  'docs.netlify.com',
  'docs.sentry.io',
  'docs.stripe.com',
  'firebase.google.com',
  'github.com',
  'gitlab.com',
  'learn.microsoft.com',
  'open-api.netlify.com',
  'posthog.com',
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
  'www.twilio.com',
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
