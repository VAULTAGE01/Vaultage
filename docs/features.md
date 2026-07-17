# Vaultage Community Feature Inventory

This document tracks the public Community product surface. Agent workflows,
CLI helpers, Services/provider connectors, managed OAuth, token lifecycle
automation, browser extension code, cloud sync/audit, spend dashboards, signing
identities, and private paid modules are outside this source distribution.

Status labels:

- **Shipped**: implemented in the staged Community source. This label does not
  prove an official binary, external distribution, or customer readiness.
- **Planned**: accepted direction, not fully built.

## Auth, Lock, And Recovery

| Status | Feature | Notes | Source |
| --- | --- | --- | --- |
| Shipped | Master-password setup and unlock | Creates the local vault, wraps the vault key, and can restore this-device-only Keychain material after password unlock. | `src/main/auth.ts`, `src/renderer/src/components/AuthScreen.tsx` |
| Shipped | macOS user-presence unlock | Uses a bundled native helper and macOS Keychain with a local-auth prompt; Touch ID is used when available and macOS may offer system-password fallback. Production helpers authenticate the containing app path, identifier, hardened-runtime signature, and matching Apple team before accepting commands. | `src/main/keychain.ts`, `src/main/keychainPolicy.ts`, `vault-keychain/` |
| Shipped | Manual lock and auto-lock | Clears in-memory vault key manually or on system suspend, screen lock, and app lifecycle transitions. | `src/main/index.ts`, `src/renderer/src/components/MainLayout.open.tsx` |
| Shipped | Keyboard shortcuts | The Community shell implements search, lock, My Vault, and Projects shortcuts only. | `src/renderer/src/components/MainLayout.open.tsx` |

## Compatibility APIs Not Exposed In The Community Shell

The shared main process retains compatibility IPC for restore,
password/sign-out controls, and reveal-PIN management. Encrypted file backup
and portable full-vault export are exposed directly through Export.
The current Community sidebar does not expose a Settings screen for those
controls, so they are not classified as user-visible Community features.

## Explicitly Not Community UI

| Capability | Community status |
| --- | --- |
| Settings modal, password change/sign-out, restore, and reveal-PIN setup | Not exposed by the Community shell; compatibility IPC is not a user-facing promise |
| Agent request server, approvals, discovery file, and CLI | Private/Pro; live implementation and renderer IPC contracts excluded; one minimal inert composition seam retained |
| Services/provider connections and remote token lifecycle | Private/Pro; live implementation and renderer IPC contracts excluded; inert compile seams retained |
| Browser-extension pairing and save handoff | Private/Pro; live implementation and renderer IPC contracts excluded; throwing/no-op compile seams retained |
| Hosted accounts, sync/audit, billing, and spend dashboards | Not included |

## My Vault

| Status | Feature | Notes | Source |
| --- | --- | --- | --- |
| Shipped | Vault dashboard | Public dashboard for local secret count, project count, pinned secrets, and recently updated secrets. | `src/renderer/src/components/SecretDetail.open.tsx` |
| Shipped | Folder tree and nested secrets | Left sidebar is the primary navigation surface for folders and secrets. | `src/renderer/src/components/Sidebar.open.tsx`, `src/renderer/src/vaultContext.tsx` |
| Shipped | Secret types | Supports password, API key, SSH key, secure note, custom, and image secrets. | `src/renderer/src/types.ts` |
| Shipped | Secret create/edit | Community add-secret flow for fields, metadata, notes, scope, tags, expiry, and usage notes. | `src/renderer/src/components/AddSecretModal.open.tsx` |
| Shipped | Copy and reveal | Saved values resolve in main process; reveal requires local confirmation. | `src/main/vaultIpc.ts`, `src/renderer/src/components/SecretDetail.open.tsx` |
| Shipped | Pinned secrets | Users can pin secrets to the local dashboard. | `src/renderer/src/lib/pinning.ts`, `src/renderer/src/components/PinSecretButton.tsx` |
| Shipped | Global search | Search across secrets and metadata. | `src/renderer/src/components/GlobalSearch.tsx` |
| Shipped | CSV import | Imports browser/password-manager-style CSV and generic spreadsheet rows with preview. | `src/renderer/src/lib/csvImport.ts`, `src/renderer/src/components/ImportModal.tsx` |
| Shipped | Scoped export, full-vault export, and encrypted file backup | The Community sidebar exposes direct full-vault portable export and raw encrypted-file backup, while selected-secret detail supports narrower export scopes. Plaintext formats require explicit confirmation. Restore remains a compatibility API outside the Community shell. | `src/renderer/src/components/Sidebar.open.tsx`, `src/renderer/src/components/SecretDetail.open.tsx`, `src/renderer/src/components/ExportModal.tsx` |
| Shipped | Redacted renderer snapshots | Sensitive saved-field values are redacted before vault snapshots reach React. | `src/main/vaultRedaction.ts`, `src/renderer/src/vaultContext.tsx` |

## Projects

| Status | Feature | Notes | Source |
| --- | --- | --- | --- |
| Shipped | Projects dashboard | Shows saved local projects, mapped key counts, and last export state. | `src/renderer/src/components/ProjectsView.open.tsx` |
| Shipped | Project scanning | Scans local folders/files for env keys, env files, frameworks, and service hints. | `src/main/projectScanner.ts`, `src/shared/projectScan.ts` |
| Shipped | Env-key mapping | Maps vault fields to project env keys. | `src/renderer/src/components/EnvProjectsModal.tsx` |
| Shipped | Explicit `.env` export | Resolves persisted mappings and destination in main, shows their exact main-owned summary, requires macOS user presence, and can add the file to `.gitignore`. New or changed paths require a purpose/Project-bound one-use native-picker grant that is cleared on lock. | `src/main/envFile.ts`, `src/main/projectIpc.ts`, `src/main/projectMutationAuthorization.ts` |

## Audit And Security

| Status | Feature | Notes | Source |
| --- | --- | --- | --- |
| Shipped | Local audit log | Redacted hash-chained audit events for sensitive main-process actions. | `src/main/audit.ts`, `src/main/auditIpc.ts` |
| Shipped | Audit viewer/export | In-app audit viewer and JSON export. | `src/renderer/src/components/AuditLogModal.tsx` |
| Shipped | Secure input bridge | Protected password inputs use macOS Secure Event Input while focused. | `src/main/secureInput.ts`, `src/renderer/src/components/SecureInputBridge.tsx` |
| Shipped | Source-drop checks | Public release gate scans for private paths, generated artifacts, known secret formats, and closed-feature artifact leaks. | `scripts/release-gates.open.mjs`, `scripts/check-source-drop-secrets.mjs`, `scripts/check-open-artifact.mjs` |

## Commercial Boundary

Closed commercial editions may add account-gated automation and hosted
workflows. Those modules are intentionally absent from this public Community
source tree.

## Keyboard Contract

| Shortcut | Community action |
| --- | --- |
| `Cmd+K` | Toggle secret search |
| `Cmd+L` | Lock the vault |
| `Cmd+1` | Open My Vault |
| `Cmd+2` | Open Projects |

No other shortcut is part of the Community shell contract until its control is
implemented and tested in the open entry points.
