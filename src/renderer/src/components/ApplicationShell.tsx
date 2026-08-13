import { useState, type ReactElement, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
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
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false);
  const patternStyle = background.patternImages
    ? { backgroundImage: background.patternImages.join(', ') }
    : undefined;

  return (
    <div className="application-shell liquid-shell relative flex h-screen flex-col overflow-hidden">
      <div className={background.patternClassName} style={patternStyle} />
      <div className="application-shell-frame relative z-10 flex flex-1 overflow-hidden">
        <button
          type="button"
          className="application-shell-navigation-toggle no-drag"
          aria-controls="application-navigation"
          aria-expanded={compactNavigationOpen}
          onClick={() => setCompactNavigationOpen(open => !open)}
        >
          {compactNavigationOpen ? <X aria-hidden size={16} /> : <Menu aria-hidden size={16} />}
          <span>Navigation</span>
        </button>
        <button
          type="button"
          className={`application-shell-navigation-backdrop${compactNavigationOpen ? ' is-compact-open' : ''}`}
          aria-label="Close navigation"
          tabIndex={compactNavigationOpen ? 0 : -1}
          onClick={() => setCompactNavigationOpen(false)}
        />
        <aside
          id="application-navigation"
          className={`application-shell-sidebar liquid-sidebar bg-sidebar${compactNavigationOpen ? ' is-compact-open' : ''}`}
          aria-label="Application navigation"
        >
          {sidebar}
        </aside>
        {children}
      </div>
    </div>
  );
}
