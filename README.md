# Vaultage

Vaultage Community is a local encrypted vault for secrets, API keys, secure
notes, and project `.env` workflows.

This repository contains the `0.1.2` pre-release source candidate. Vaultage has
not published an official Community binary or customer-ready release. After
the first signed candidate is accepted, official `v0.x` updates will be manual
downloads from this repository's GitHub Releases page.

The supported desktop and packaging target is macOS 12 or newer. Windows and
Linux installers are not implemented or advertised.

This public source distribution includes My Vault and local Projects only. It
does not require an account, has no active-Project limit, and does not include Agent workflows, CLI helpers,
Services/provider connectors, managed OAuth, token lifecycle automation,
browser extension code, cloud sync/audit, spend dashboards, signing identities,
or private paid modules.

Product, feature, architecture, and release docs live in [docs/](./docs/README.md).

## Current Product Surface

- **My Vault**: encrypted local vault with macOS user-presence unlock (Touch ID
  when available; macOS may offer system-password fallback), folders,
  secrets, import/export, reveal/copy flows, and local audit viewing/export.
- **Projects**: local project records, project scanning, env-key mapping, and
  explicit `.env` export from the unlocked local vault.

## Security Posture

Current guarantees live in [SECURITY.md](./SECURITY.md).

Important constraints:

- Plaintext JSON and `.env` export flows require the flow-specific explicit
  confirmation: macOS user presence where configured, or exact typed
  confirmation where specified. Non-macOS builds are not a supported product.
- Protected password inputs use macOS Secure Event Input while focused.
- CSV import has explicit size and parser-shape limits before creating secrets.
- Sensitive main-process events are written to a redacted hash-chained local
  audit log foundation.

Legal ownership and protective notices live in [NOTICE](./NOTICE),
[DISCLAIMER.md](./DISCLAIMER.md), and [TRADEMARK.md](./TRADEMARK.md).

## Development

Install dependencies:

```sh
pnpm install
```

Run the Community release gate:

```sh
pnpm verify:release
```

Useful focused checks:

```sh
pnpm test
pnpm exec tsc --noEmit --pretty false -p tsconfig.node.json
pnpm exec tsc --noEmit --pretty false -p tsconfig.web.json
pnpm check:boundaries
pnpm check:schemas
pnpm check:source-drop-secrets
pnpm build:open-local
pnpm check:open-artifact
```

See [docs/README.md](./docs/README.md) for the docs map,
[docs/ci-cd.md](./docs/ci-cd.md) for CI, and
[docs/repo-structure.md](./docs/repo-structure.md) for the source boundary.

## Commercial Editions

Vaultage Community protects local secrets and maps them to local projects.
Closed commercial editions may add account-gated automation and hosted
workflows. Those modules are not part of this public source distribution.

## License

The public Community source distribution is licensed under Apache-2.0.

Vaultage is a project, product, and brand of Arcalab, a sole proprietorship.
See [NOTICE](./NOTICE) and [DISCLAIMER.md](./DISCLAIMER.md) for ownership,
no-warranty, misuse, and liability notices.

See [TRADEMARK.md](./TRADEMARK.md) for the policy covering the Vaultage name,
logos, official builds, and release channels.
