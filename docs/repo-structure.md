# Vaultage Community Repo Structure

Status: public Community source structure.

## Distribution Model

This repository contains the Apache-2.0 Vaultage Community source surface:

- My Vault.
- Local Projects.
- Local audit viewing/export.
- Import/export.
- Project scanning, env-key mapping, and explicit `.env` export.
- Public docs, security policy, legal notices, and Community release gates.

It intentionally does not contain Agent workflows, CLI helpers,
Services/provider connectors, managed OAuth, scoped-token creation,
rotation/revocation, browser extension code, cloud sync/audit, spend
dashboards, signing credentials, private planning reports, or paid overlay
modules.

## Important Paths

- `src/main`: Electron main process, auth/vault/project IPC, audit logging,
  crypto/storage helpers, disabled closed-feature seams, and window setup.
- `src/preload`: sandboxed preload bridge between renderer and main.
- `src/renderer`: React desktop UI for My Vault and Projects.
- `schemas`: public JSON Schemas for the local vault format.
- `scripts`: Community release gates, boundary checks, artifact checks, and
  source safety checks.
- `docs`: public product and implementation docs.
- `NOTICE`, `DISCLAIMER.md`, `SECURITY.md`, `TRADEMARK.md`: ownership,
  protective, security, and brand-boundary documents.
- `resources`: icons and generated helper-binary destination.
- `vault-keychain`: Swift source for the macOS Keychain helper.
- `.github`: public Community CI, issue templates, and PR template.

## Boundary Rules

- Community surface: My Vault, Projects, local audit, import/export, project
  scanning, env-key mapping, public docs, and disabled seams for closed
  features.
- Private/Pro surface: Agent workflows, CLI helpers, Services/provider
  connectors, managed OAuth, scoped-token creation, rotation/revocation,
  premium service catalog, browser extension, hosted sync/cloud audit tier,
  spend dashboards, signing credentials, and brand assets unless explicitly
  licensed separately.
- Community builds must not import paid overlay modules.

## Generated Paths To Keep Out Of Source

- `.env`
- `node_modules`
- `dist`
- `out`
- `resources/vault-keychain`
- `*.tsbuildinfo`
