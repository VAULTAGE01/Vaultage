## Summary

Describe the change and why it is needed.

## Security Impact

- [ ] No security-sensitive behavior changed.
- [ ] Security-sensitive behavior changed and the threat-model impact is described below.

Impact:

## Checks

- [ ] `pnpm test`
- [ ] `pnpm exec tsc --noEmit --pretty false -p tsconfig.node.json`
- [ ] `pnpm exec tsc --noEmit --pretty false -p tsconfig.web.json`
- [ ] `pnpm audit --dev`
- [ ] `pnpm build`

## Sensitive Data

- [ ] This PR does not include real secrets, provider tokens, vault files, `.env` contents, or screenshots of secret values.
