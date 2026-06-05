import { spawnSync } from 'child_process'

const checks = [
  ['pnpm', ['test']],
  ['pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.node.json']],
  ['pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.web.json']],
  ['pnpm', ['check:boundaries']],
  ['pnpm', ['check:entitlements']],
  ['pnpm', ['check:schemas']],
  ['pnpm', ['check:source-drop-secrets']],
  ['pnpm', ['publish:check']],
  ['pnpm', ['audit', '--dev']],
  ['pnpm', ['build:open-local']],
  ['pnpm', ['check:open-artifact']],
]

for (const [cmd, args] of checks) {
  console.log(`\n==> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nAll open release gates passed.')
