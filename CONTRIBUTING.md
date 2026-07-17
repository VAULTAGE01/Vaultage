# Contributing To Vaultage

Vaultage is pre-release. Public contributions are not open yet because
trademark policy owner review and the open/paid boundary are still being
finalized. The planned public Community source drop is Apache-2.0.

This document is the intended contribution posture for the public open-core release.

## Before Contributing

- Do not include real secrets, vault files, provider tokens, screenshots of secret values, or `.env` contents.
- Open a discussion or issue before large architectural changes.
- Security-sensitive changes must describe their threat-model impact.
- Agent workflows, CLI helpers, Services/provider code, provider lifecycle
  automation, cloud account code, managed OAuth, browser extension code, and
  paid overlay modules must stay out of the Community source surface unless
  explicitly relicensed.

## Development Checks

Run these before opening a pull request:

```sh
pnpm test
pnpm exec tsc --noEmit --pretty false -p tsconfig.node.json
pnpm exec tsc --noEmit --pretty false -p tsconfig.web.json
pnpm audit --dev
pnpm verify:release
```

## Commit/PR Expectations

- Keep changes scoped.
- Add or update tests for behavior changes.
- Update docs when changing security guarantees, open-source boundaries, audit events, or plaintext export behavior.
- Never weaken runtime validation or Electron hardening without an explicit security rationale.

## Certificate Of Origin

The recommended public posture is Developer Certificate of Origin sign-off rather than a CLA:

```text
Signed-off-by: Your Name <you@example.com>
```

This is not active until the public contribution policy is finalized.
