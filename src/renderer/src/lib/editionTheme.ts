export type AuthBackdropPalette = 'green' | 'darkGrey'

interface OpenAuthBackdropContract {
  gradientPalette: Extract<AuthBackdropPalette, 'darkGrey'>
  gradientSpeed: number
  gradientOpacity: number
  overlayClassName: string
  patternClassName: string
  patternImages: readonly string[]
}

interface ClosedAuthBackdropContract {
  gradientPalette: Extract<AuthBackdropPalette, 'green'>
  gradientSpeed: number
  gradientOpacity: number
  overlayClassName: string
  noiseClassName: string
}

interface OpenShellBackgroundContract {
  patternClassName: string
  patternImages: readonly string[]
}

interface ClosedShellBackgroundContract {
  patternClassName: string
}

const AUTH_BACKDROP_OVERLAY =
  'absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,rgba(2,8,6,0.56)_0%,rgba(2,8,6,0.34)_45%,rgba(2,8,6,0.68)_100%)]'

export const OPEN_AUTH_BACKDROP_CONTRACT = {
  gradientPalette: 'darkGrey',
  gradientSpeed: 0.18,
  gradientOpacity: 0.74,
  overlayClassName: AUTH_BACKDROP_OVERLAY,
  patternClassName: 'absolute inset-0 pointer-events-none opacity-28 mix-blend-screen',
  patternImages: [
    'linear-gradient(135deg, rgba(255,255,255,0.045), transparent 34%)',
    'radial-gradient(circle at 24% 18%, rgba(255,255,255,0.042), transparent 22%)',
    'radial-gradient(circle at 82% 12%, rgba(210,220,214,0.052), transparent 24%)',
  ],
} as const satisfies OpenAuthBackdropContract

export const CLOSED_AUTH_BACKDROP_CONTRACT = {
  gradientPalette: 'green',
  gradientSpeed: 0.18,
  gradientOpacity: 0.74,
  overlayClassName: AUTH_BACKDROP_OVERLAY,
  noiseClassName: 'liquid-noise absolute inset-0 pointer-events-none opacity-30',
} as const satisfies ClosedAuthBackdropContract

export const OPEN_SHELL_BACKGROUND_CONTRACT = {
  patternClassName: 'pointer-events-none absolute inset-0 opacity-35 mix-blend-screen',
  patternImages: [
    'linear-gradient(135deg, rgba(255,255,255,0.05), transparent 34%)',
    'radial-gradient(circle at 24% 18%, rgba(255,255,255,0.045), transparent 22%)',
    'radial-gradient(circle at 82% 12%, rgba(210,220,214,0.055), transparent 24%)',
  ],
} as const satisfies OpenShellBackgroundContract

export const CLOSED_SHELL_BACKGROUND_CONTRACT = {
  patternClassName: 'liquid-noise absolute inset-0 pointer-events-none opacity-35',
} as const satisfies ClosedShellBackgroundContract
