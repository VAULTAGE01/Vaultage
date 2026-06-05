export const MIN_MASTER_PASSWORD_LENGTH = 12

const COMMON_PASSWORDS = new Set([
  '123456789012',
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'qwerty',
  'qwerty123',
  'letmein',
  'letmein123',
  'admin',
  'admin123',
  'changeme',
  'changeme123',
  'vaultage',
])

export function masterPasswordPolicyError(password: string, field = 'password'): string | null {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    return `${field} must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`
  }

  const normalized = password.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (COMMON_PASSWORDS.has(normalized)) {
    return `${field} is too common`
  }

  if (/^(.)\1+$/.test(password)) {
    return `${field} cannot be one repeated character`
  }

  return null
}

export function masterPasswordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: '' }
  let score = 0
  if (password.length >= MIN_MASTER_PASSWORD_LENGTH) score++
  if (password.length >= 20) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  const labels = ['', 'Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']
  return { score, label: labels[Math.min(score, 5)] }
}
