export type SurfaceSearchKeyboardEvent = Pick<
  globalThis.KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

export function isSurfaceSearchShortcut(
  event: SurfaceSearchKeyboardEvent,
): boolean {
  return (
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLocaleLowerCase() === 'k'
  );
}
