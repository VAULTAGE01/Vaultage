export interface Ui2026BuildFlags {
  readonly vault: boolean;
  readonly projects: boolean;
  readonly services: boolean;
}

function resolveFlag(value: string | undefined, defaultValue: boolean): boolean {
  return value === undefined ? defaultValue : value === '1';
}

export function resolveUi2026BuildFlags(
  environment: Readonly<Record<string, string | undefined>>,
): Ui2026BuildFlags {
  return Object.freeze({
    vault: resolveFlag(environment['VAULTAGE_UI2026_VAULT'], false),
    projects: resolveFlag(environment['VAULTAGE_UI2026_PROJECTS'], false),
    services: resolveFlag(environment['VAULTAGE_UI2026_SERVICES'], true),
  });
}
