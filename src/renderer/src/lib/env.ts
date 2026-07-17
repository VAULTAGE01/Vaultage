// ────────────────────────────────────────────────────────────────────────────
// Environment ("scope") design system.
//
// One source of truth for env labels, colors, and ordering. Every component
// that displays or filters by `secret.scope` should pull from here so a solo
// builder always sees the same red for production, the same amber for
// staging, etc.
// ────────────────────────────────────────────────────────────────────────────

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
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
