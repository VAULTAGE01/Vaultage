import { describe, expect, it } from 'vitest';
import {
  resolveUi2026BuildFlags,
  resolveUi2026BuildFlagsForEdition,
} from './ui2026BuildFlags';

describe('UI 2026 landing build flags', () => {
  it('keeps the established Vault and Projects landings while enabling Services', () => {
    expect(resolveUi2026BuildFlags({})).toEqual({
      vault: false,
      projects: false,
      services: true,
    });
  });

  it('keeps an explicit per-surface rollback switch', () => {
    expect(resolveUi2026BuildFlags({
      VAULTAGE_UI2026_VAULT: '0',
      VAULTAGE_UI2026_PROJECTS: '1',
      VAULTAGE_UI2026_SERVICES: 'invalid',
    })).toEqual({
      vault: false,
      projects: true,
      services: false,
    });
  });

  it('enables Community Vault and Projects while keeping Services private', () => {
    expect(resolveUi2026BuildFlagsForEdition({}, true)).toEqual({
      vault: true,
      projects: true,
      services: false,
    });
    expect(resolveUi2026BuildFlagsForEdition({
      VAULTAGE_UI2026_VAULT: '0',
      VAULTAGE_UI2026_PROJECTS: '0',
      VAULTAGE_UI2026_SERVICES: '1',
    }, true)).toEqual({
      vault: false,
      projects: false,
      services: false,
    });
  });

  it('preserves closed edition defaults', () => {
    expect(resolveUi2026BuildFlagsForEdition({}, false)).toEqual({
      vault: false,
      projects: false,
      services: true,
    });
  });
});
