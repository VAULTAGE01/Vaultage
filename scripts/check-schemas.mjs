import { readdirSync, readFileSync, statSync } from 'fs'
import { basename, join } from 'path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const schemaDir = join(process.cwd(), 'schemas')
const fixtureDir = join(schemaDir, 'fixtures')
const failures = []
const schemas = new Map()
const compiledSchemaIds = new Set()

for (const path of jsonFiles(schemaDir).filter(path => !path.startsWith(`${fixtureDir}/`))) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed['$schema'] !== 'https://json-schema.org/draft/2020-12/schema') {
      failures.push(`${path} is missing the expected draft 2020-12 $schema`)
    }
    if (!parsed['$id']) failures.push(`${path} is missing $id`)
    if (!parsed.title) failures.push(`${path} is missing title`)
    schemas.set(path, parsed)
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${safeError(error)}`)
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
addFormats(ajv)

for (const [path, schema] of schemas) {
  try {
    ajv.addSchema(schema)
    const validator = ajv.getSchema(schema.$id)
    if (!validator) throw new Error('schema did not produce a validator')
    compiledSchemaIds.add(schema.$id)
  } catch (error) {
    failures.push(`${path} does not compile: ${safeError(error)}`)
  }
}

const fixtureCoverage = new Map()
for (const path of jsonFiles(fixtureDir)) {
  const match = /^(.*)\.(valid|invalid)\.json$/.exec(basename(path))
  if (!match) {
    failures.push(`${path} must end in .valid.json or .invalid.json`)
    continue
  }
  const [, schemaStem, expectation] = match
  const schemaPath = join(schemaDir, `${schemaStem}.schema.json`)
  const schema = schemas.get(schemaPath)
  if (!schema) {
    failures.push(`${path} has no matching schema ${schemaPath}`)
    continue
  }
  if (!compiledSchemaIds.has(schema.$id)) continue
  let validator
  try {
    validator = ajv.getSchema(schema.$id)
  } catch (error) {
    failures.push(`${path} could not load its compiled schema: ${safeError(error)}`)
    continue
  }
  if (!validator) {
    failures.push(`${path} could not resolve its compiled schema`)
    continue
  }
  let fixture
  try {
    fixture = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${safeError(error)}`)
    continue
  }

  const valid = validator(fixture)
  if (expectation === 'valid' && !valid) {
    failures.push(`${path} should be valid: ${ajv.errorsText(validator.errors, { dataVar: '$' })}`)
  }
  if (expectation === 'invalid' && valid) {
    failures.push(`${path} should be rejected but passed validation`)
  }
  const coverage = fixtureCoverage.get(schemaStem) ?? new Set()
  coverage.add(expectation)
  fixtureCoverage.set(schemaStem, coverage)
}

const vaultCoverage = fixtureCoverage.get('vault-root.v2')
if (!vaultCoverage?.has('valid') || !vaultCoverage?.has('invalid')) {
  failures.push('vault-root.v2 schema requires both representative valid and invalid fixtures')
}

if (failures.length > 0) {
  console.error('Schema checks failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`Schema checks passed (${schemas.size} compiled schemas, ${jsonFiles(fixtureDir).length} fixtures).`)

function jsonFiles(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) files.push(...jsonFiles(path))
    else if (name.endsWith('.json')) files.push(path)
  }
  return files
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error)
}
