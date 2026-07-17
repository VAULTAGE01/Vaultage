# Vaultage Community Instructions for Claude

Follow `docs/ci-cd.md` as the canonical delivery and housekeeping process,
then read `docs/architecture.md` and the relevant feature documentation.

- Preserve the public Vault + Projects boundary; closed commercial surfaces do
  not belong in this repository without an approved boundary decision.
- Do not commit or print credentials, tokens, private keys, plaintext vault
  content, user project values, or private product/release evidence.
- Preserve unrelated work and avoid destructive Git cleanup.
- Use focused tests and typechecks for ordinary feature work. Run the full local
  `pnpm verify:release` suite once at a security/source-boundary, milestone,
  or release checkpoint. Required hosted Linux PR CI remains the merge
  checkpoint for every PR. Update tests, docs, schemas, boundary checks, and
  source scans together.
- During pre-release development, an agent may merge its own ordinary PR after
  required Linux PR CI passes, then confirm the post-merge `main` SHA is green.
  Security, source-boundary, and release work still requires independent or
  maintainer review.
- Do not publish, tag, sign, or claim a release from local evidence alone.

Propose process changes in `docs/ci-cd.md` so every agent family follows one
policy.
