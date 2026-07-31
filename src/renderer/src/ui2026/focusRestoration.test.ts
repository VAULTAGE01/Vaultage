import { describe, expect, it, vi } from 'vitest';
import { scheduleElementFocus } from './focusRestoration';

describe('scheduleElementFocus', () => {
  it('captures the requested target and focuses it after the rendered frame', () => {
    const focus = vi.fn();
    const findTarget = vi.fn(() => ({ focus }));
    let scheduled: FrameRequestCallback | undefined;

    const frame = scheduleElementFocus(
      'rail-search',
      (callback) => {
        scheduled = callback;
        return 42;
      },
      findTarget,
    );

    expect(frame).toBe(42);
    expect(focus).not.toHaveBeenCalled();

    scheduled?.(0);

    expect(findTarget).toHaveBeenCalledWith('rail-search');
    expect(focus).toHaveBeenCalledOnce();
  });
});
