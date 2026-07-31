import type { ReactElement, ReactNode } from 'react';
import type { ShellBackgroundContract } from '../lib/editionTheme';

export function ApplicationShell({
  background,
  sidebar,
  children,
}: {
  readonly background: ShellBackgroundContract;
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const patternStyle = background.patternImages
    ? { backgroundImage: background.patternImages.join(', ') }
    : undefined;

  return (
    <div className="application-shell liquid-shell relative flex h-screen flex-col overflow-hidden">
      <div className={background.patternClassName} style={patternStyle} />
      <div className="application-shell-frame relative z-10 flex flex-1 overflow-hidden">
        <aside
          className="application-shell-sidebar liquid-sidebar relative flex w-[260px] flex-shrink-0 flex-col overflow-hidden rounded-r-[26px] bg-sidebar"
          aria-label="Application navigation"
        >
          {sidebar}
        </aside>
        {children}
      </div>
    </div>
  );
}
