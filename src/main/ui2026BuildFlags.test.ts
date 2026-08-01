import { describe, expect, it } from 'vitest';
import {
  resolveUi2026BuildFlags,
  resolveUi2026BuildFlagsForEdition,
} from './ui2026BuildFlags';

describe('UI 2026 landing build flags', () => {
  it('enables the launch Vault, Projects, and Services surfaces by default', () => {
    expect(resolveUi2026BuildFlags({})).toEqual({
      vault: true,
      projects: true,
      services: true,
    });
  });

  it('keeps an explicit per-surface rollback switch', () => {
    expect(resolveUi2026BuildFlags({
      VAULTAGE_UI2026_VAULT: '0',
      VAULTAGE_UI2026_PROJECTS: '0',
      VAULTAGE_UI2026_SERVICES: '0',
    })).toEqual({
      vault: false,
      projects: false,
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
      vault: true,
      projects: true,
      services: true,
    });
  });
});
