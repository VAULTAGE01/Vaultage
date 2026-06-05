const SAFE_DOTENV_VALUE_RE = /^[A-Za-z0-9_./:@%+=,\-]+$/

function formatDotenvValue(value) {
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

function formatDotenvEntries(entries, options = {}) {
  const lines = []
  if (options.header) lines.push(options.header)
  for (const entry of entries) {
    lines.push(`${entry.envKey}=${formatDotenvValue(entry.value)}`)
  }
  lines.push('')
  return lines.join('\n')
}

function formatDotenv(env) {
  return formatDotenvEntries(
    Object.entries(env).map(([envKey, value]) => ({ envKey, value: String(value) })),
  )
}

module.exports = {
  formatDotenv,
  formatDotenvEntries,
  formatDotenvValue,
}
