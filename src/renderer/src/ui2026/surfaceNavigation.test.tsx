import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  markPendingSurfaceFocus,
  pendingSurfaceFocusMatches,
  schedulePendingSurfaceFocus,
  SurfaceSwitcher,
  takePendingSurfaceFocus,
} from './surfaceNavigation';

describe('SurfaceSwitcher focus continuity', () => {
  it('gives every remounted surface navigation control a stable id', () => {
    const html = renderToStaticMarkup(
      <SurfaceSwitcher
        value="projects"
        available={{ vault: true, projects: true, services: true }}
        onValueChange={(): void => undefined}
      />,
    );

    expect(html).toContain('id="ui26-surface-control-vault"');
    expect(html).toContain('id="ui26-surface-control-projects"');
    expect(html).toContain('id="ui26-surface-control-services"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('aria-controls=');
  });

  it('consumes only the matching unexpired remount focus intent', () => {
    markPendingSurfaceFocus('projects', 100);

    expect(takePendingSurfaceFocus('services', 200)).toBe(false);
    expect(takePendingSurfaceFocus('projects', 200)).toBe(true);
    expect(takePendingSurfaceFocus('projects', 200)).toBe(false);

    markPendingSurfaceFocus('services', 100);
    expect(takePendingSurfaceFocus('services', 1_601)).toBe(false);
  });

  it('preserves a matching intent until the surviving StrictMode frame consumes it', () => {
    markPendingSurfaceFocus('projects', 100);
    const focus = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const scheduleFrame = (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    };

    expect(schedulePendingSurfaceFocus('projects', scheduleFrame, () => ({ focus }), () => 200)).toBe(1);
    expect(schedulePendingSurfaceFocus('projects', scheduleFrame, () => ({ focus }), () => 200)).toBe(2);
    expect(focus).not.toHaveBeenCalled();

    frames[1]?.(0);

    expect(focus).toHaveBeenCalledOnce();
    expect(pendingSurfaceFocusMatches('projects', 200)).toBe(false);

    frames[0]?.(0);
    expect(focus).toHaveBeenCalledOnce();
  });
});
