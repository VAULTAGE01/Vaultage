import { useEffect } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { cn } from '@/lib/utils'
import type { Ui2026Surface } from './flags'
import { nextAvailableSurface } from './primitives'

const SURFACES = [
  'vault',
  'projects',
  'services',
] as const satisfies readonly Ui2026Surface[]

type PendingSurfaceFocus = {
  readonly surface: Ui2026Surface
  readonly expiresAt: number
}

let pendingSurfaceFocus: PendingSurfaceFocus | null = null
const FOCUS_INTENT_TTL_MS = 1_500

export function markPendingSurfaceFocus(
  surface: Ui2026Surface,
  now = Date.now(),
): void {
  pendingSurfaceFocus = {
    surface,
    expiresAt: now + FOCUS_INTENT_TTL_MS,
  }
}

export function takePendingSurfaceFocus(
  surface: Ui2026Surface,
  now = Date.now(),
): boolean {
  if (!pendingSurfaceFocus) return false
  if (pendingSurfaceFocus.expiresAt < now) {
    pendingSurfaceFocus = null
    return false
  }
  if (pendingSurfaceFocus.surface !== surface) return false
  pendingSurfaceFocus = null
  return true
}

export function pendingSurfaceFocusMatches(
  surface: Ui2026Surface,
  now = Date.now(),
): boolean {
  if (!pendingSurfaceFocus) return false
  if (pendingSurfaceFocus.expiresAt < now) {
    pendingSurfaceFocus = null
    return false
  }
  return pendingSurfaceFocus.surface === surface
}

export function surfaceControlId(surface: Ui2026Surface): string {
  return 'ui26-surface-control-' + surface
}

export function schedulePendingSurfaceFocus(
  surface: Ui2026Surface,
  scheduleFrame: (callback: FrameRequestCallback) => number = (callback) =>
    window.requestAnimationFrame(callback),
  findTarget: (id: string) => { focus(): void } | null = (id) =>
    document.getElementById(id),
  now: () => number = Date.now,
): number | null {
  if (!pendingSurfaceFocusMatches(surface, now())) return null
  return scheduleFrame(() => {
    if (!takePendingSurfaceFocus(surface, now())) return
    findTarget(surfaceControlId(surface))?.focus()
  })
}

export function SurfaceSwitcher({
  value,
  available,
  onValueChange,
  showUnavailable = false,
}: {
  readonly value: Ui2026Surface
  readonly available: Readonly<Record<Ui2026Surface, boolean>>
  readonly onValueChange: (surface: Ui2026Surface) => void
  readonly showUnavailable?: boolean
}): ReactElement {
  useEffect(() => {
    const frame = schedulePendingSurfaceFocus(value)
    if (frame === null) return
    return () => window.cancelAnimationFrame(frame)
  }, [value])

  const visibleSurfaces = showUnavailable
    ? SURFACES
    : SURFACES.filter((surface) => available[surface])
  const selectSurface = (surface: Ui2026Surface): void => {
    if (surface === value || !available[surface]) return
    markPendingSurfaceFocus(surface)
    onValueChange(surface)
  }
  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    direction: 1 | -1,
  ): void => {
    event.preventDefault()
    const next = nextAvailableSurface(value, available, direction)
    selectSurface(next)
  }

  return (
    <nav className='ui26-surface-nav' aria-label='Surface navigation'>
      <div className='ui26-switcher'>
        {visibleSurfaces.map((surface) => (
          <button
            id={surfaceControlId(surface)}
            key={surface}
            type='button'
            aria-current={value === surface ? 'page' : undefined}
            tabIndex={value === surface ? 0 : -1}
            disabled={!available[surface]}
            onClick={() => selectSurface(surface)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                selectFromKeyboard(event, 1)
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                selectFromKeyboard(event, -1)
              }
            }}
            className={cn('ui26-tab', value === surface && 'is-active')}
          >
            {surface === 'vault'
              ? 'Vault'
              : surface === 'projects'
                ? 'Projects'
                : 'Services'}
          </button>
        ))}
      </div>
    </nav>
  )
}
