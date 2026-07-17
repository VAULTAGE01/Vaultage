# Vaultage Community Instructions for Claude

Follow `docs/ci-cd.md` as the canonical delivery and housekeeping process,
then read `docs/architecture.md` and the relevant feature documentation.

- Preserve the public Vault + Projects boundary; closed commercial surfaces do
  not belong in this repository without an approved boundary decision.
- Do not commit or print credentials, tokens, private keys, plaintext vault
  content, user project values, or private product/release evidence.
- Preserve unrelated work and avoid destructive Git cleanup.
- Run `pnpm verify:release` and update tests, docs, schemas, boundary checks,
  and source scans together.
- Do not publish, tag, sign, or claim a release from local evidence alone.

Propose process changes in `docs/ci-cd.md` so every agent family follows one
policy.
