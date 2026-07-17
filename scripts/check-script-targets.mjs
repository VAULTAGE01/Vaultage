import { validateLocalPackageTargets } from './script-targets.mjs'

const failures = validateLocalPackageTargets(process.cwd())
if (failures.length > 0) {
  console.error('Local package target checks failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('Local package script and bin targets passed.')
