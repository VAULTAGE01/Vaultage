import { useEffect, useRef } from 'react';
import type { Ui2026Surface } from '../ui2026/flags';
import type { SetupDestination } from './SetupScreen';

export function ui2026SurfaceForMode(
  mode: 'local' | 'agent' | 'integrations',
): Ui2026Surface {
  if (mode === 'agent') return 'projects';
  if (mode === 'integrations') return 'services';
  return 'vault';
}

interface FreshSetupState {
  readonly destination: SetupDestination;
  readonly justCompleted: boolean;
  readonly pendingRecoveryKit: boolean;
}

interface FreshSetupActions {
  readonly openAccountPlan: () => void;
  readonly resetToVault: () => void;
}

export function useFreshSetupDestination(
  state: FreshSetupState,
  actions: FreshSetupActions,
): void {
  const appliedVaultLanding = useRef(false);
  const pendingAccountSetup = useRef(state.destination === 'account');

  useEffect(() => {
    if (!state.justCompleted || appliedVaultLanding.current) return;
    appliedVaultLanding.current = true;
    actions.resetToVault();
  }, [actions.resetToVault, state.justCompleted]);

  useEffect(() => {
    if (
      !pendingAccountSetup.current
      || !state.justCompleted
      || state.pendingRecoveryKit
    ) return;
    pendingAccountSetup.current = false;
    actions.openAccountPlan();
  }, [actions.openAccountPlan, state.justCompleted, state.pendingRecoveryKit]);
}

export function useMainLayoutKeyboardShortcuts(
  lock: () => void,
  switchSurface: (surface: 'vault' | 'projects' | 'services') => void,
  toggleSearch: () => void,
): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleMainLayoutShortcut(event, {
      lock,
      switchSurface,
      toggleSearch,
    });
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lock, switchSurface, toggleSearch]);
}

interface MainLayoutShortcutEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly preventDefault: () => void;
  readonly shiftKey: boolean;
}

interface MainLayoutShortcutActions {
  readonly lock: () => void;
  readonly switchSurface: (surface: 'vault' | 'projects' | 'services') => void;
  readonly toggleSearch: () => void;
}

export function handleMainLayoutShortcut(
  event: MainLayoutShortcutEvent,
  actions: MainLayoutShortcutActions,
): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'k' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.toggleSearch();
    return;
  }
  if (key === 'l' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.lock();
    return;
  }
  if (key === '1' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.switchSurface('vault');
    return;
  }
  if (key === '2' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.switchSurface('projects');
    return;
  }
  if (key === '3' && !event.shiftKey && !event.altKey && !__VAULTAGE_OPEN_CORE__) {
    event.preventDefault();
    actions.switchSurface('services');
  }
}
