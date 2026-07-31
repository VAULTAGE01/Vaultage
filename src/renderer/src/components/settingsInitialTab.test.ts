import { describe, expect, it } from 'vitest';
import { resolveInitialSettingsTab } from './settingsInitialTab';

describe('resolveInitialSettingsTab', () => {
  it('keeps an Account & Plan navigation request on the account tab', () => {
    expect(resolveInitialSettingsTab('account', false)).toBe('account');
  });

  it('keeps the deferred browser tab hidden when extension access is unavailable', () => {
    expect(resolveInitialSettingsTab('browser', false)).toBe('general');
  });
});
