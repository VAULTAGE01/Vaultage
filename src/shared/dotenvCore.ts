export interface DotenvEntry {
  envKey: string
  value: string
}

const SAFE_DOTENV_VALUE_RE = /^[A-Za-z0-9_./:@%+=,\-]+$/

export function formatDotenvValue(value: string): string {
  const text = String(value)
  if (text === '') return '""'
  if (SAFE_DOTENV_VALUE_RE.test(text)) return text
  return `"${text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`
}

export function formatDotenvEntries(entries: DotenvEntry[], options: { header?: string } = {}): string {
  const lines: string[] = []
  if (options.header) lines.push(options.header)
  for (const entry of entries) {
    lines.push(`${entry.envKey}=${formatDotenvValue(entry.value)}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function formatDotenv(env: Record<string, string>): string {
  return formatDotenvEntries(
    Object.entries(env).map(([envKey, value]) => ({ envKey, value: String(value) })),
  )
}
