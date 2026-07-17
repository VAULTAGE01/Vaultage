# Vaultage Community Agent Instructions

These instructions apply to Codex/OpenAI-based agents in the public Community
repository. Read `docs/ci-cd.md`, `docs/architecture.md`, and the relevant
feature documentation before editing.

- Preserve the public Vault + Projects boundary. Do not add Agent, CLI,
  Services/provider, extension, cloud account, entitlement, signing, or paid
  overlay implementation without an approved public-boundary decision.
- Never commit or print credentials, tokens, private keys, plaintext vault
  content, user project values, crash dumps containing values, or private
  product/release evidence.
- Preserve unrelated user work and avoid destructive Git cleanup.
- Run `pnpm verify:release` for a complete candidate. Update tests,
  documentation, schemas, boundary rules, and source scans with the code.
- Do not publish, tag, sign, or claim a release from local checks alone. Follow
  the hosted-CI, review, provenance, and artifact rules in `docs/ci-cd.md`.

The canonical process lives in `docs/ci-cd.md`; do not duplicate it here.
