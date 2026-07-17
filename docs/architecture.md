# Vaultage Community Architecture

Vaultage Community is an Electron desktop app with a React renderer, a sandboxed
preload bridge, and a main process that owns vault unlock, storage, audit, and
project file operations.

## Process Model

```
React renderer
  -> sandboxed preload API
  -> Electron main process
  -> encrypted vault file, local audit log, project files, macOS Keychain helper
```

The renderer receives redacted vault snapshots. Sensitive saved-field values
are resolved in the main process for copy/reveal/export actions after the user
confirms the action.

Before accepting a command, the native Keychain helper authenticates its direct
parent with Security.framework. Production execution requires the expected app
identifier and containing bundle path, valid hardened-runtime signatures, an
Apple-anchored Developer ID certificate, and the same team identifier on the
helper and app. It also validates the whole containing app's nested-code and
resource seal. Production packaging disables Electron's Node execution and
injection fuses and enables ASAR integrity plus ASAR-only loading. Electron
preflights the helper file and signature. Ad-hoc local packages retain a
path-bound lower-assurance development policy.

## Included IPC Surface

- `auth:*` for setup, unlock, password confirmation, and lock state.
- `vault:*` for local vault reads/writes, reveal/copy, import/export, audit,
  settings, and safe platform actions.
- `project:*` for explicit local project picking, scanning, and `.env`
  export.

Closed-feature IPC is disabled in the Community build and must not be exposed by
the public preload bridge.

## Data Model

The local vault stores:

- folders,
- secrets and saved fields,
- local project mappings,
- preferences,
- audit metadata.

Compatibility fields may exist in older encrypted vault files, but Community UI
and IPC expose only Vault and Projects behavior.

## Important Paths

- `src/main/auth.ts`: setup, unlock, password changes, and key wrapping.
- `src/main/vaultIpc.ts`: Vault IPC and plaintext confirmation gates.
- `src/main/projectIpc.ts`: project scan and export IPC.
- `src/main/projectScanner.ts`: local project scan implementation.
- `src/preload/index.ts`: public preload API.
- `src/renderer/src/components/MainLayout.open.tsx`: Community UI shell.
- `src/renderer/src/components/SecretDetail.open.tsx`: Vault dashboard/detail.
- `src/renderer/src/components/ProjectsView.open.tsx`: Projects dashboard.
