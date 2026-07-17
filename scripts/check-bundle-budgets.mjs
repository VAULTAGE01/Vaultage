import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()
const budgets = [
  { dir: 'out/main', suffix: '.js', perFile: 1_500_000, total: 2_000_000 },
  { dir: 'out/preload', suffix: '.js', perFile: 300_000, total: 500_000 },
  { dir: 'out/renderer', suffix: '.js', perFile: 1_000_000, total: 1_500_000 },
]

for (const budget of budgets) {
  const files = await walk(join(root, budget.dir))
  const matches = files.filter(file => file.endsWith(budget.suffix))
  if (matches.length === 0) fail(`no ${budget.suffix} bundles found under ${budget.dir}`)
  let total = 0
  for (const file of matches) {
    const bytes = (await stat(file)).size
    total += bytes
    if (bytes > budget.perFile) {
      fail(`${relative(root, file)} is ${bytes} bytes (per-file budget ${budget.perFile})`)
    }
  }
  if (total > budget.total) fail(`${budget.dir} totals ${total} bytes (budget ${budget.total})`)
  console.log(`${budget.dir}: ${total} bytes across ${matches.length} JavaScript bundle(s)`)
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function fail(message) {
  console.error(`Bundle budget failed: ${message}`)
  process.exit(1)
}
