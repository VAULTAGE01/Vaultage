export type SettingsInitialTab = 'account' | 'general' | 'browser';

export function resolveInitialSettingsTab(
  initialTab: SettingsInitialTab | undefined,
  extensionUiReleased: boolean,
): SettingsInitialTab {
  if (initialTab === 'browser' && !extensionUiReleased) return 'general';
  return initialTab ?? 'general';
}
