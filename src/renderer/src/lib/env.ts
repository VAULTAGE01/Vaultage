// ────────────────────────────────────────────────────────────────────────────
// Environment ("scope") design system.
//
// One source of truth for env labels, colors, and ordering. Every component
// that displays or filters by `secret.scope` should pull from here so a solo
// builder always sees the same red for production, the same amber for
// staging, etc.
// ────────────────────────────────────────────────────────────────────────────

export const ENV_PRESETS = [
  'production',
  'staging',
  'development',
  'testing',
] as const

export type EnvPreset = typeof ENV_PRESETS[number]

// "Lower" envs come first; promotion typically moves up this list.
export const ENV_PROMOTION_ORDER: readonly EnvPreset[] = [
  'development',
  'testing',
  'staging',
  'production',
]

export interface EnvVisual {
  label:       string   // capitalized display label
  short:       string   // 3–4 char abbrev for tight spaces
  color:       string   // hex
  borderRgba:  string   // rgba string for borders / accents
  bgRgba:      string   // rgba string for chip background
  textRgba:    string   // rgba string for chip text
  danger?:     boolean  // production: treat as destructive
}

const VISUALS: Record<string, EnvVisual> = {
  production: {
    label:      'Production',
    short:      'PROD',
    color:      '#f43f5e',
    borderRgba: 'rgba(244,63,94,0.32)',
    bgRgba:     'rgba(244,63,94,0.10)',
    textRgba:   'rgba(253,164,175,1)',
    danger:     true,
  },
  staging: {
    label:      'Staging',
    short:      'STG',
    color:      '#f59e0b',
    borderRgba: 'rgba(245,158,11,0.30)',
    bgRgba:     'rgba(245,158,11,0.10)',
    textRgba:   'rgba(253,186,116,1)',
  },
  development: {
    label:      'Development',
    short:      'DEV',
    color:      '#3b82f6',
    borderRgba: 'rgba(59,130,246,0.30)',
    bgRgba:     'rgba(59,130,246,0.10)',
    textRgba:   'rgba(147,197,253,1)',
  },
  testing: {
    label:      'Testing',
    short:      'TEST',
    color:      '#a855f7',
    borderRgba: 'rgba(168,85,247,0.30)',
    bgRgba:     'rgba(168,85,247,0.10)',
    textRgba:   'rgba(216,180,254,1)',
  },
}

// Neutral fallback for custom / unset scopes.
const NEUTRAL_VISUAL: EnvVisual = {
  label:      'Custom',
  short:      'ENV',
  color:      '#737373',
  borderRgba: 'rgba(115,115,115,0.30)',
  bgRgba:     'rgba(115,115,115,0.10)',
  textRgba:   'rgba(212,212,212,1)',
}

/**
 * Resolve a scope string (or undefined) to its visual treatment.
 * Custom scopes that aren't in our preset list get the neutral palette but
 * keep their user-provided label.
 */
export function getEnvVisual(scope: string | null | undefined): EnvVisual {
  if (!scope) return { ...NEUTRAL_VISUAL, label: 'Unscoped', short: '—' }
  const known = VISUALS[scope]
  if (known) return known
  return { ...NEUTRAL_VISUAL, label: capitalize(scope), short: scope.slice(0, 4).toUpperCase() }
}

export function isProductionScope(scope: string | null | undefined): boolean {
  return scope === 'production'
}

/** Order presets first (in promotion order), then everything else alphabetically. */
export function sortScopes(scopes: string[]): string[] {
  const presetIndex = new Map<string, number>(
    ENV_PROMOTION_ORDER.map((s, i) => [s, i]),
  )
  return [...scopes].sort((a, b) => {
    const ai = presetIndex.get(a)
    const bi = presetIndex.get(b)
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1
    if (bi !== undefined) return 1
    return a.localeCompare(b)
  })
}

/** Given a scope, return the next "higher" env to promote to. */
export function nextPromotionScope(current: string | null | undefined): EnvPreset | null {
  if (!current) return ENV_PROMOTION_ORDER[0]
  const idx = (ENV_PROMOTION_ORDER as readonly string[]).indexOf(current)
  if (idx === -1) return null
  if (idx + 1 >= ENV_PROMOTION_ORDER.length) return null
  return ENV_PROMOTION_ORDER[idx + 1]
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
