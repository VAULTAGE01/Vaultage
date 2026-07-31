type FocusTarget = {
  focus(): void
}

type ScheduleFrame = (callback: FrameRequestCallback) => number
type FindTarget = (id: string) => FocusTarget | null

export function scheduleElementFocus(
  targetId: string,
  scheduleFrame: ScheduleFrame = (callback) =>
    window.requestAnimationFrame(callback),
  findTarget: FindTarget = (id) => document.getElementById(id),
): number {
  return scheduleFrame(() => {
    findTarget(targetId)?.focus()
  })
}
