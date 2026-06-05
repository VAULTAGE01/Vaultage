import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const files = [
  'build/entitlements.mac.plist',
  'build/entitlements.mac.inherit.plist',
]

const forbiddenKeys = [
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.cs.allow-dyld-environment-variables',
]

let failed = false

for (const file of files) {
  const body = readFileSync(join(root, file), 'utf8')
  if (!body.includes('com.apple.security.cs.allow-jit')) {
    console.error(`${file} is missing com.apple.security.cs.allow-jit`)
    failed = true
  }
  for (const key of forbiddenKeys) {
    if (body.includes(key)) {
      console.error(`${file} includes broad entitlement ${key}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)

console.log('Entitlement checks passed.')
