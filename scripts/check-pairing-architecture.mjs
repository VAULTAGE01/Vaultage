import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  findPrivatePreloadIpcChannelLeaks,
  isPrivateOverlaySourcePath,
} from './open-source-config.mjs'

const PAIRING_MODULE_LIMIT = 250
const AGENT_SERVER_LIMIT = 1798
const AGENT_COMPOSITION_LIMIT = 250
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|mjs|swift)$/u
const TEST_FILE = /(?:^|\.)test\.[cm]?[jt]sx?$/u
const IGNORED_DIRECTORIES = new Set(['.git', '.vaultage-open-source', 'dist', 'node_modules', 'out'])

const PAIRING_MODULE_PATH = /^(?:browser-extension\/native-host-swift\/Pairing[^/]*\.swift|browser-extension\/.+\/pairing-[^/]+\.(?:js|mjs)|src\/main\/browserExtensionPairing[^/]*\.[cm]?[jt]sx?|src\/shared\/(?:browserExtensionContracts|extensionPairing)[^/]*\.[cm]?[jt]sx?|src\/preload\/(?:browserExtensionBridge|extensionPairing)[^/]*\.[cm]?[jt]sx?|src\/renderer\/.*\/(?:ExtensionPairing[^/]*|useExtensionPairing)\.[cm]?[jt]sx?)$/u

const AGENT_SERVER_FORBIDDEN = Object.freeze([
  ['pairing store/schema/bootstrap logic', /\b(?:browserExtensionPairing(?:Store|FileStore|Schema)|ExtensionPairing(?:BootstrapRecord|Record|Schema)|bootstrap(?:Nonce|Timestamp|Signature|Envelope))\b/u],
])

const AGENT_CONTRACT_FORBIDDEN = Object.freeze([
  ['pairing contract', /\b(?:browserExtensionIpcContracts|browserExtensionIpcEvents|extensionPairingIpcContracts|AgentExtensionPairingResponsePayload|ExtensionPairing(?:ApprovalRequest|Browser|RecoveryReasonCode|Status(?:Result)?))\b/u],
])

const PRELOAD_FORBIDDEN = Object.freeze([
  ['pairing bridge implementation', /ipcRenderer\.(?:invoke|send|on|once|removeListener)\s*\([\s\S]{0,180}?(?:pairing|extension-pairing)/iu],
])

const ACTIVATION_MARKERS = Object.freeze([
  /\bPAIRING_(?:BOOTSTRAP|PROTOCOL|VERIFIER)(?:_TYPE|_VERSION|_FLAG)?\b/u,
  /\b(?:pairingBootstrapRequest|signedNativeRequest)\b/u,
  /\bvaultage\.(?:pairingBootstrap|signedRequest)\b/u,
  /--vaultage-pairing-verifier/u,
])

const SWIFT_PAIRING_SOURCE_PATH = /^browser-extension\/native-host-swift\/(?:Pairing[^/]*|NativeHostProtocol|main)\.swift$/u
const SWIFT_PAIRING_REQUIRED_FILES = Object.freeze([
  'browser-extension/native-host-swift/PairingCodec.swift',
  'browser-extension/native-host-swift/PairingProtocol.swift',
  'browser-extension/native-host-swift/PairingPersistence.swift',
  'browser-extension/native-host-swift/PairingState.swift',
  'browser-extension/native-host-swift/PairingVerifier.swift',
  'browser-extension/native-host-swift/PairingDispatch.swift',
  'browser-extension/native-host-swift/main.swift',
])

const ACTIVATION_FILES = Object.freeze([
  'vault-keychain/main.swift',
  'browser-extension/extension/background.js',
  'browser-extension/extension/popup.js',
  'browser-extension/extension/manifest.json',
  'browser-extension/native-host/install-chrome-host.mjs',
  'browser-extension/native-host/com.vaultage.desktop.json.example',
  'electron-builder.yml',
  'electron-builder.production.yml',
  'scripts/build-browser-extension.mjs',
  'scripts/build-extension-native-host.sh',
  'scripts/browser-extension-artifact-lib.mjs',
  'src/main/browserExtensionNativeHostRegistrar.ts',
  'src/main/extensionNativeHostComposition.ts',
  'src/main/extensionNativeHostComposition.production.ts',
])

const NODE_CUSTOMER_ARTIFACT_FILES = Object.freeze([
  'electron-builder.yml',
  'electron-builder.production.yml',
  '.github/workflows/release.yml',
])

const NODE_CUSTOMER_ARTIFACT_MARKERS = Object.freeze([
  'browser-extension/native-host/',
  'extension:install-host',
  'VAULTAGE_NATIVE_HOST_PATH',
])

const COMMUNITY_BOUNDARY_FILES = Object.freeze([
  'scripts/stage-open-source.mjs',
  'scripts/verify-open-source-stage.mjs',
  'scripts/publish-readiness.mjs',
])

const COMMUNITY_PRIVATE_PAIRING_MARKERS = Object.freeze([
  'browser-extension/native-host-swift/',
  'PairingCodec.swift',
  'PairingProtocol.swift',
  'PairingPersistence.swift',
  'PairingState.swift',
  'PairingVerifier.swift',
  'PairingDispatch.swift',
])

const PAIRING_PRELOAD_TERMS = Object.freeze([
  'vault:respond-extension-pairing',
  'vault:get-extension-pairing-status',
  'vault:unpair-extension-pairing',
  'vault:extension-pairing-request',
  'vault:extension-pairing-expired',
])

const PUBLIC_PAIRING_TERMS = Object.freeze(['extension.pairing.', ...PAIRING_PRELOAD_TERMS])

function normalizePath(path) {
  return path.replaceAll('\\', '/')
}

export function countPureLoc(source) {
  return source.split(/\r?\n/u)
    .filter(line => {
      const trimmed = line.trim()
      return trimmed !== '' && !/^(?:\/\/|#|--)/u.test(trimmed)
    }).length
}

function sourceFiles(root, directory = root, result = []) {
  if (!existsSync(directory)) return result
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) sourceFiles(root, absolute, result)
    else if (entry.isFile()) result.push(normalizePath(relative(root, absolute)))
  }
  return result
}

function read(root, path) {
  const absolute = join(root, path)
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
}

function pushPatternFailures(failures, path, source, rules) {
  for (const [label, pattern] of rules) {
    if (!pattern.test(source)) continue
    failures.push(`${path} contains forbidden ${label}`)
  }
}

function hasActivationMarker(source) {
  return ACTIVATION_MARKERS.some(marker => marker.test(source))
}

function isSwiftTestingGuarded(source, term) {
  let testingConditionalDepth = 0
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*#if\s+VAULTAGE_TESTING\b/u.test(line)) testingConditionalDepth += 1
    if (line.includes(term) && testingConditionalDepth === 0) return false
    if (/^\s*#endif\b/u.test(line) && testingConditionalDepth > 0) testingConditionalDepth -= 1
  }
  return true
}

function pairingProductionModules(root, files) {
  return files.filter(path => SOURCE_EXTENSIONS.test(path)
    && !TEST_FILE.test(path)
    && PAIRING_MODULE_PATH.test(path))
}

function pairingSourceCandidates(files) {
  return files.filter(path => {
    if (path.startsWith('browser-extension/')) return true
    if (path.startsWith('test-fixtures/') && /pairing/iu.test(path)) return true
    return path.startsWith('src/') && /(?:pairing|ExtensionPairing|browserExtensionPairing)/iu.test(path)
  })
}

function checkModuleSizes(root, failures, observations, files) {
  for (const path of pairingProductionModules(root, files)) {
    const source = read(root, path)
    if (source === null) continue
    const pureLoc = countPureLoc(source)
    observations[path] = pureLoc
    if (pureLoc > PAIRING_MODULE_LIMIT) {
      failures.push(`${path} pairing production module has ${pureLoc} pure LOC (maximum ${PAIRING_MODULE_LIMIT})`)
    }
  }
}

function checkTopology(root, failures, observations) {
  const checks = [
    ['src/main/agentServer.ts', AGENT_SERVER_LIMIT, 'Agent server'],
    ['src/main/agentComposition.ts', AGENT_COMPOSITION_LIMIT, 'Agent composition'],
  ]
  for (const [path, limit, label] of checks) {
    const source = read(root, path)
    if (source === null) continue
    const pureLoc = countPureLoc(source)
    observations[path] = pureLoc
    if (pureLoc > limit) failures.push(`${path} ${label} has ${pureLoc} pure LOC (maximum ${limit})`)
  }

  const agentServer = read(root, 'src/main/agentServer.ts')
  if (agentServer !== null) pushPatternFailures(failures, 'src/main/agentServer.ts', agentServer, AGENT_SERVER_FORBIDDEN)

  const agentContracts = read(root, 'src/shared/agentIpcContracts.ts')
  if (agentContracts !== null) pushPatternFailures(
    failures,
    'src/shared/agentIpcContracts.ts',
    agentContracts,
    AGENT_CONTRACT_FORBIDDEN,
  )

  const preload = read(root, 'src/preload/index.ts')
  if (preload !== null) pushPatternFailures(failures, 'src/preload/index.ts', preload, PRELOAD_FORBIDDEN)
}

function checkPrivateSourceCoverage(failures, files) {
  for (const path of pairingSourceCandidates(files)) {
    if (!isPrivateOverlaySourcePath(path)) {
      failures.push(`${path} pairing source is not covered by private source staging`)
    }
  }
}

function checkPrivatePreloadTermCoverage(failures) {
  for (const term of PAIRING_PRELOAD_TERMS) {
    if (findPrivatePreloadIpcChannelLeaks(term).includes(term)) continue
    failures.push(`${term} pairing IPC term is not covered by private preload leak detection`)
  }
}

function checkPublicSourceTerms(root, failures, files) {
  for (const path of files.filter(candidate => candidate.startsWith('src/') && !TEST_FILE.test(candidate))) {
    const openReplacement = path.replace(/(\.[cm]?[jt]sx?)$/u, '.open$1')
    if (isPrivateOverlaySourcePath(path) || openReplacement !== path && read(root, openReplacement) !== null) continue
    const source = read(root, path)
    if (source === null) continue
    for (const term of PUBLIC_PAIRING_TERMS) {
      if (source.includes(term)) failures.push(`${path} contains pairing term that would survive Community staging: ${term}`)
    }
  }
}

function checkSwiftPairingSource(root, failures, files) {
  const swiftFiles = files.filter(path => /\.swift$/u.test(path)
    && (path.startsWith('vault-keychain/') || path.startsWith('browser-extension/native-host-swift/')))
  const pairingFiles = swiftFiles.filter(path => {
    const source = read(root, path)
    return source !== null && hasActivationMarker(source)
  })
  if (pairingFiles.length === 0) return

  for (const path of pairingFiles) {
    const source = read(root, path)
    if (source === null) continue
    if (!SWIFT_PAIRING_SOURCE_PATH.test(path)) {
      failures.push(`${path} Swift pairing source is outside the parity seam`)
    }
  }

  const missingFiles = SWIFT_PAIRING_REQUIRED_FILES.filter(path => read(root, path) === null)
  if (missingFiles.length > 0) {
    failures.push(`Swift pairing source is missing parity files: ${missingFiles.join(', ')}`)
  }

  const main = read(root, 'browser-extension/native-host-swift/main.swift') ?? ''
  const hasUnsignedDefaultDispatch = /if[\s\S]{0,260}?PairingDispatch\.pairingVerifierEnabledFromArgv[\s\S]{0,900}?else[\s\S]{0,420}?(?:NativeHostHandler[^\n]{0,120}?\.handle|\b(?:handler|legacyHandler)\.handle)\s*\(\s*message\s*\)/u.test(main)
  if (!hasUnsignedDefaultDispatch) {
    failures.push('Swift pairing source lacks an unsigned-compatible Swift default dispatch')
  }

  for (const path of SWIFT_PAIRING_REQUIRED_FILES) {
    const source = read(root, path)
    if (source === null) continue
    for (const term of ['VAULTAGE_NATIVE_HOST_TEST_PAIRING_PATH', 'VAULTAGE_NATIVE_HOST_TEST_PAIRING_REPLAY_DIRECTORY']) {
      if (source.includes(term) && !isSwiftTestingGuarded(source, term)) {
        failures.push(`${path} Swift pairing test-only override is not guarded by VAULTAGE_TESTING`)
      }
    }
  }
}

function checkActivationReadiness(root, failures) {
  const sources = Object.fromEntries(ACTIVATION_FILES.map(path => [path, read(root, path) ?? '']))
  const background = sources['browser-extension/extension/background.js']
  if (!background.includes('signedNativeRequest')) return
  const required = [
    ['browser-extension/extension/background.js', 'pairingBootstrapRequest'],
    ['browser-extension/extension/background.js', 'PAIRING_HOST_UPGRADE_REQUIRED'],
    ['browser-extension/extension/background.js', "sendSignedNative('vaultage.requestSecrets'"],
    ['browser-extension/extension/background.js', "sendSignedNative('vaultage.saveCandidate'"],
    ['browser-extension/extension/background.js', "sendSignedNative('vaultage.openApp'"],
    ['browser-extension/native-host/install-chrome-host.mjs', '--vaultage-pairing-verifier'],
    ['scripts/build-extension-native-host.sh', '--candidate'],
    ['scripts/build-extension-native-host.sh', 'VAULTAGE_DEVELOPMENT -D VAULTAGE_PAIRING_REQUIRED'],
    ['scripts/build-extension-native-host.sh', 'VAULTAGE_CANDIDATE -D VAULTAGE_PAIRING_REQUIRED'],
    ['scripts/build-extension-native-host.sh', 'VAULTAGE_PRODUCTION -D VAULTAGE_PAIRING_REQUIRED'],
    ['browser-extension/native-host-swift/main.swift', '#if VAULTAGE_PAIRING_REQUIRED'],
    ['electron.vite.config.ts', 'VAULTAGE_EXTENSION_CANDIDATE_BUILD'],
    ['src/main/extensionNativeHostComposition.ts', 'candidateBuild'],
  ]
  for (const [path, marker] of required) {
    const source = read(root, path) ?? ''
    if (!source.includes(marker)) failures.push(`${path} packaged pairing activation is incomplete: ${marker}`)
  }
}

function checkNodeCustomerArtifacts(root, failures) {
  for (const path of NODE_CUSTOMER_ARTIFACT_FILES) {
    const source = read(root, path)
    if (source === null) continue
    for (const marker of NODE_CUSTOMER_ARTIFACT_MARKERS) {
      if (source.includes(marker)) {
        failures.push(`${path} contains Node transport selected by a customer package`)
      }
    }
  }
}

function checkCommunityBoundary(root, failures) {
  for (const path of COMMUNITY_BOUNDARY_FILES) {
    const source = read(root, path)
    if (source === null) continue
    for (const marker of COMMUNITY_PRIVATE_PAIRING_MARKERS) {
      if (source.includes(marker)) {
        failures.push(`${path} Community staging selects private Swift pairing source: ${marker}`)
      }
    }
  }
}

export function evaluatePairingArchitecture(root = process.cwd()) {
  const resolvedRoot = resolve(root)
  const failures = []
  const observations = {}
  const files = sourceFiles(resolvedRoot)
  checkModuleSizes(resolvedRoot, failures, observations, files)
  checkTopology(resolvedRoot, failures, observations)
  checkPrivateSourceCoverage(failures, files)
  checkPrivatePreloadTermCoverage(failures)
  checkPublicSourceTerms(resolvedRoot, failures, files)
  checkSwiftPairingSource(resolvedRoot, failures, files)
  checkActivationReadiness(resolvedRoot, failures)
  checkNodeCustomerArtifacts(resolvedRoot, failures)
  checkCommunityBoundary(resolvedRoot, failures)
  return { failures, observations }
}

function main() {
  const root = process.argv[2] ?? process.cwd()
  const result = evaluatePairingArchitecture(root)
  if (result.failures.length > 0) {
    console.error('Pairing architecture checks failed:')
    for (const failure of result.failures) console.error(`  - ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`Pairing architecture checks passed: ${resolve(root)}`)
  for (const [path, pureLoc] of Object.entries(result.observations)) {
    console.log(`  ${path}: ${pureLoc} pure LOC`)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
