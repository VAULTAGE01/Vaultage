import { spawnSync } from 'child_process'
import { exit, platform } from 'process'

const env = { ...process.env, VAULTAGE_OPEN_CORE: '1' }
const commands = platform === 'darwin'
  ? [
      ['bash', ['build-helper.sh']],
      ['pnpm', ['exec', 'electron-vite', 'build']],
    ]
  : [
      ['pnpm', ['exec', 'electron-vite', 'build']],
    ]

for (const [cmd, args] of commands) {
  console.log(`\n==> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', env })
  if (result.status !== 0) exit(result.status ?? 1)
}
