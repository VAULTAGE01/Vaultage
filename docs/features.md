# Vaultage Community Feature Inventory

This document tracks the public Community product surface. Agent workflows,
CLI helpers, Services/provider connectors, managed OAuth, token lifecycle
automation, browser extension code, cloud sync/audit, spend dashboards, signing
identities, and private paid modules are outside this source distribution.

Status labels:

- **Shipped**: implemented in the Community app.
- **Planned**: accepted direction, not fully built.

## Auth, Lock, And Recovery

| Status | Feature | Notes | Source |
| --- | --- | --- | --- |
| Shipped | Master-password setup and unlock | Creates local vault, wraps the vault key, and restores Touch ID material after password unlock. | `src/main/auth.ts`, `src/renderer/src/components/AuthScreen.tsx` |
| Shipped | Touch ID unlock | Uses bundled native helper and macOS Keychain with a local-auth prompt for Touch ID or Mac password fallback. | `src/main/keychain.ts`, `vault-keychain/` |
| Shipped | Quick reveal PIN | Settings can create, replace, or remove a 4-digit reveal PIN after confirming the master password. | `src/main/vaultIpc.ts`, `src/main/auth.ts`, `src/main/vaultRedaction.ts` |
| Shipped | Manual lock and auto-lock | Clears in-memory vault key manually or on system suspend, screen lock, and app lifecycle transitions. | `src/main/index.ts`, `src/renderer/src/components/MainLayout.open.tsx` |
| Shipped | Keyboard shortcuts | Search, lock, Vault, Projects, import, export, settings, and shortcuts modal. | `src/renderer/src/components/KeyboardShortcutsModal.tsx` |

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
| Shipped | Export | Encrypted, JSON, and CSV export paths with plaintext confirmation where needed. | `src/renderer/src/components/ExportModal.tsx`, `src/main/vaultIpc.ts` |
| Shipped | Redacted renderer snapshots | Sensitive saved-field values are redacted before vault snapshots reach React. | `src/main/vaultRedaction.ts`, `src/renderer/src/vaultContext.tsx` |

## Projects

| Status | Feature | Notes | Source |
| --- | --- | --- | --- |
| Shipped | Projects dashboard | Shows saved local projects, mapped key counts, and last export state. | `src/renderer/src/components/ProjectsView.open.tsx` |
| Shipped | Project scanning | Scans local folders/files for env keys, env files, frameworks, and service hints. | `src/main/projectScanner.ts`, `src/shared/projectScan.ts` |
| Shipped | Env-key mapping | Maps vault fields to project env keys. | `src/renderer/src/components/EnvProjectsModal.tsx` |
| Shipped | Explicit `.env` export | Writes selected mapped values to local project `.env` files and can add them to `.gitignore`. | `src/main/envFile.ts`, `src/main/projectIpc.ts` |

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
