import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const schemaDir = join(process.cwd(), 'schemas')
const failures = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      walk(path)
      continue
    }
    if (!name.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed['$schema'] !== 'https://json-schema.org/draft/2020-12/schema') {
        failures.push(`${path} is missing the expected draft 2020-12 $schema`)
      }
      if (!parsed['$id']) failures.push(`${path} is missing $id`)
      if (!parsed.title) failures.push(`${path} is missing title`)
    } catch (err) {
      failures.push(`${path} is not valid JSON: ${String(err)}`)
    }
  }
}

walk(schemaDir)

if (failures.length > 0) {
  console.error('Schema checks failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('Schema checks passed.')
