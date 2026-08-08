export function safeDiagnosticErrorCode(reason: unknown): string {
  if (!reason || typeof reason !== 'object') return 'UNKNOWN'
  const code = Reflect.get(reason, 'code')
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(code)
    ? code
    : 'UNKNOWN'
}
