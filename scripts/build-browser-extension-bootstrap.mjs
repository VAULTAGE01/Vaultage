#!/usr/bin/env node
import { buildFirstStoreItemBootstrapArtifact } from './browser-extension-artifact-lib.mjs'

if (process.argv.length !== 2) {
  throw new Error('usage: build-browser-extension-bootstrap.mjs')
}

const result = await buildFirstStoreItemBootstrapArtifact()
console.log(`Built first-item bootstrap Store ZIP: ${result.artifactName}`)
console.log(`SHA-256: ${result.zipSha256}`)
console.log(`Bytes: ${result.byteLength}`)
console.log(`Entries: ${result.entries.length}`)
console.log('This ZIP is not a final release artifact; do not submit or promote it.')
