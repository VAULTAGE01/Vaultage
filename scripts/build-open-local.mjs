import { spawnSync } from 'child_process'
import { rmSync } from 'fs'
import { exit, platform } from 'process'
import { resolve } from 'path'

const env = {
  ...process.env,
  VAULTAGE_OPEN_CORE: '1',
  VAULTAGE_UI2026_VAULT: '1',
  VAULTAGE_UI2026_PROJECTS: '1',
  VAULTAGE_UI2026_SERVICES: '0',
}
rmSync(resolve(process.cwd(), 'out'), { recursive: true, force: true })
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
