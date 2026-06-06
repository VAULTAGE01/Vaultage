import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const distDir = join(process.cwd(), 'dist')
const outFile = join(distDir, 'SHASUMS256.txt')
const allowedExtensions = new Set(['.dmg', '.zip', '.yml', '.blockmap', '.exe'])

function extname(file) {
  const lower = file.toLowerCase()
  for (const ext of allowedExtensions) {
    if (lower.endsWith(ext)) return ext
  }
  return ''
}

if (!existsSync(distDir)) {
  console.error('dist/ does not exist. Build release artifacts before checksumming.')
  process.exit(1)
}

const files = readdirSync(distDir)
  .filter(file => allowedExtensions.has(extname(file)))
  .filter(file => file !== 'builder-debug.yml')
  .filter(file => file !== 'SHASUMS256.txt')
  .sort((a, b) => a.localeCompare(b))

if (files.length === 0) {
  console.error('No release artifacts found in dist/.')
  process.exit(1)
}

const lines = files.map((file) => {
  const data = readFileSync(join(distDir, file))
  const digest = createHash('sha256').update(data).digest('hex')
  return `${digest}  ${file}`
})

writeFileSync(outFile, `${lines.join('\n')}\n`)
console.log(`Wrote ${outFile}`)
