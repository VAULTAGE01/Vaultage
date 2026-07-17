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
- Use focused tests and typechecks for ordinary feature work. Run the full local
  `pnpm verify:release` suite once at a security/source-boundary, milestone,
  or release checkpoint. Required hosted Linux PR CI remains the merge
  checkpoint for every PR. Update tests, documentation, schemas, boundary
  rules, and source scans with the code.
- During pre-release development, an agent may merge its own ordinary PR after
  required Linux PR CI passes, then confirm the post-merge `main` SHA is green.
  Security, source-boundary, and release work still requires independent or
  maintainer review.
- Do not publish, tag, sign, or claim a release from local checks alone. Follow
  the hosted-CI, review, provenance, and artifact rules in `docs/ci-cd.md`.

The canonical process lives in `docs/ci-cd.md`; do not duplicate it here.
