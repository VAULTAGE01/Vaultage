import { spawnSync } from 'child_process'

const checks = [
  ['pnpm', ['run', 'test']],
  ['pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.node.json']],
  ['pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.web.json']],
  ['pnpm', ['run', 'check:open-types']],
  ['pnpm', ['run', 'check:boundaries']],
  ['pnpm', ['run', 'check:entitlements']],
  ['pnpm', ['run', 'check:electron-fuses']],
  ['pnpm', ['run', 'check:keychain-boundary']],
  ['pnpm', ['run', 'check:release-metadata']],
  ['pnpm', ['run', 'check:script-targets']],
  ['pnpm', ['run', 'check:schemas']],
  ['pnpm', ['run', 'check:product-truth']],
  ['pnpm', ['run', 'check:source-drop-secrets']],
  ['pnpm', ['run', 'check:native-vnext-export']],
  ['pnpm', ['run', 'publish:check']],
  ['pnpm', ['audit', '--prod']],
  ['pnpm', ['audit', '--dev']],
  ['pnpm', ['run', 'build:open-local']],
  ['pnpm', ['run', 'check:open-artifact']],
  ['pnpm', ['run', 'check:bundle-budgets']],
  ['pnpm', ['run', 'check:preload-surfaces', '--', '--edition', 'open']],
]

for (const [cmd, args] of checks) {
  console.log(`\n==> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nAll open release gates passed.')
