import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluatePairingArchitecture } from './check-pairing-architecture.mjs'

const fixtures = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function createFixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-pairing-architecture-'))
  fixtures.push(root)
  for (const [path, source] of Object.entries(files)) {
    const absolutePath = join(root, path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
  }
  return root
}

function lines(count, line = 'const fixture = true') {
  return `${Array.from({ length: count }, () => line).join('\n')}\n`
}

function healthyFixture(extra = {}) {
  return createFixture({
    'src/main/agentServer.ts': lines(10),
    'src/main/agentComposition.ts': lines(10),
    'src/shared/agentIpcContracts.ts': lines(10),
    'src/preload/index.ts': lines(10),
    'vault-keychain/main.swift': '// Swift helper without pairing activation\n',
    ...extra,
  })
}

function swiftPairingParityFixture(extra = {}) {
  return healthyFixture({
    'browser-extension/native-host-swift/PairingProtocol.swift': [
      'let pairingBootstrapType = "vaultage.pairingBootstrap"',
      'let signedRequestType = "vaultage.signedRequest"',
    ].join('\n'),
    'browser-extension/native-host-swift/PairingCodec.swift': 'enum PairingCanonicalJSON {}\n',
    'browser-extension/native-host-swift/PairingState.swift': [
      '#if VAULTAGE_TESTING',
      'let pairingPath = ProcessInfo.processInfo.environment["VAULTAGE_NATIVE_HOST_TEST_PAIRING_PATH"]',
      '#endif',
    ].join('\n'),
    'browser-extension/native-host-swift/PairingPersistence.swift': 'struct PairingReplayStore {}\n',
    'browser-extension/native-host-swift/PairingVerifier.swift': [
      'func verifyAndConsumePairingBootstrap() {}',
      'func verifyAndConsumeSignedRequest() {}',
    ].join('\n'),
    'browser-extension/native-host-swift/PairingDispatch.swift': [
      'private let pairingVerifierFlag = "--vaultage-pairing-verifier"',
      'static func pairingVerifierEnabledFromArgv(_ argv: [String]) -> Bool {',
      '  let pairingVerifierFlagCount = argv.filter { $0 == pairingVerifierFlag }.count',
      '  return pairingVerifierFlagCount == 1',
      '}',
    ].join('\n'),
    'browser-extension/native-host-swift/main.swift': [
      'if PairingDispatch.pairingVerifierEnabledFromArgv(CommandLine.arguments) {',
      '  PairingDispatch().handle(message)',
      '} else {',
      '  NativeHostHandler(paths: paths).handle(message)',
      '}',
    ].join('\n'),
    ...extra,
  })
}

describe('pairing architecture boundary', () => {
  it('accepts a bounded topology with only delegated pairing seams', () => {
    const root = healthyFixture({
      'src/main/browserExtensionPairingHttp.ts': lines(4),
      'src/shared/extensionPairingIpcContracts.ts': lines(4),
      'src/preload/extensionPairingBridge.ts': lines(4),
      'src/renderer/src/hooks/useExtensionPairing.ts': lines(4),
      'browser-extension/native-host/pairing-verifier.mjs': lines(4),
    })

    expect(evaluatePairingArchitecture(root).failures).toEqual([])
  })

  it('rejects an oversized pairing production module', () => {
    const root = healthyFixture({
      'src/main/browserExtensionPairingHttp.ts': lines(251),
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /browserExtensionPairingHttp\.ts.*251.*250/u,
    )
  })

  it('rejects an oversized Swift pairing production module', () => {
    const root = swiftPairingParityFixture({
      'browser-extension/native-host-swift/PairingCodec.swift': lines(251, 'let fixtureValue = true'),
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /PairingCodec\.swift.*251.*250/u,
    )
  })

  it('rejects oversized existing aggregators', () => {
    const root = healthyFixture({
      'src/main/agentServer.ts': lines(1_799),
      'src/main/agentComposition.ts': lines(251),
    })
    const failures = evaluatePairingArchitecture(root).failures.join('\n')

    expect(failures).toMatch(/agentServer\.ts.*1799.*1798/u)
    expect(failures).toMatch(/agentComposition\.ts.*251.*250/u)
  })

  it('rejects pairing store, schema, and bootstrap logic in Agent server', () => {
    const root = healthyFixture({
      'src/main/agentServer.ts': 'import { BrowserExtensionPairingStore } from \'./browserExtensionPairingStore\'\n',
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /agentServer\.ts.*store.*schema.*bootstrap|agentServer\.ts.*pairing/u,
    )
  })

  it('rejects pairing contracts in the Agent contract aggregator', () => {
    const root = healthyFixture({
      'src/shared/agentIpcContracts.ts': 'export type ExtensionPairingStatus = { readonly state: \'unpaired\' }\n',
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /agentIpcContracts\.ts.*pairing contract/u,
    )
  })

  it('rejects direct pairing IPC implementation in the preload entrypoint', () => {
    const root = healthyFixture({
      'src/preload/index.ts': "ipcRenderer.invoke('vault:respond-extension-pairing', payload)\n",
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /preload\/index\.ts.*pairing bridge/u,
    )
  })

  it('accepts source-only Swift signed pairing with fail-closed dispatch invariants', () => {
    const root = swiftPairingParityFixture()

    expect(evaluatePairingArchitecture(root).failures).toEqual([])
  })

  it('accepts a benign local rename in the exact-one development flag gate', () => {
    const root = swiftPairingParityFixture({
      'browser-extension/native-host-swift/PairingDispatch.swift': [
        'private let pairingVerifierFlag = "--vaultage-pairing-verifier"',
        'static func pairingVerifierEnabledFromArgv(_ argv: [String]) -> Bool {',
        '  let explicitPairingFlagMatches = argv.filter { $0 == pairingVerifierFlag }.count',
        '  return explicitPairingFlagMatches == 1',
        '}',
      ].join('\n'),
    })

    expect(evaluatePairingArchitecture(root).failures).toEqual([])
  })

  it('rejects Swift pairing source that replaces the unsigned default dispatch', () => {
    const root = swiftPairingParityFixture({
      'browser-extension/native-host-swift/main.swift': [
        'if PairingDispatch.pairingVerifierEnabledFromArgv(CommandLine.arguments) {',
        '  PairingDispatch().handle(message)',
        '}',
      ].join('\n'),
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /unsigned-compatible Swift default dispatch/u,
    )
  })

  it('rejects Swift pairing test-path overrides outside VAULTAGE_TESTING', () => {
    const root = swiftPairingParityFixture({
      'browser-extension/native-host-swift/PairingState.swift': 'let pairingPath = ProcessInfo.processInfo.environment["VAULTAGE_NATIVE_HOST_TEST_PAIRING_PATH"]\n',
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /test-only override is not guarded by VAULTAGE_TESTING/u,
    )
  })

  it('rejects pairing literals in Swift outside the dedicated source seam', () => {
    const root = healthyFixture({
      'browser-extension/native-host-swift/NativeHostSecurity.swift': 'let marker = "vaultage.pairingBootstrap"\n',
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /Swift pairing source is outside the parity seam/u,
    )
  })

  it('rejects Node transport in a customer package', () => {
    const path = 'electron-builder.production.yml'
    const source = 'extraResources:\n  - from: browser-extension/native-host/vaultage-native-host.mjs\n'
    const root = healthyFixture({ [path]: source })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /electron-builder\.production\.yml.*Node transport/u,
    )
  })

  it('rejects partial packaged pairing activation', () => {
    const root = healthyFixture({
      'browser-extension/extension/background.js': 'signedNativeRequest()\n',
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /packaged pairing activation is incomplete/u,
    )
  })

  it('rejects Community staging of the private Swift pairing source', () => {
    const root = healthyFixture({
      'scripts/stage-open-source.mjs': 'const privateSource = "browser-extension/native-host-swift/PairingProtocol.swift"\n',
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /Community staging.*private Swift pairing/u,
    )
  })

  it('accepts harmless release prose in Swift pairing comments', () => {
    const root = swiftPairingParityFixture({
      'browser-extension/native-host-swift/PairingProtocol.swift': [
        'let pairingBootstrapType = "vaultage.pairingBootstrap"',
        'let signedRequestType = "vaultage.signedRequest"',
        '// A production release still requires signing and notarization evidence.',
      ].join('\n'),
    })

    expect(evaluatePairingArchitecture(root).failures).toEqual([])
  })

  it('rejects a pairing module that is not covered by private source staging', () => {
    const root = healthyFixture({
      'src/preload/pairingBridgeNotCovered.ts': lines(4),
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /pairingBridgeNotCovered\.ts.*private source staging/u,
    )
  })

  it('rejects pairing audit/event terms in a public source module', () => {
    const root = healthyFixture({
      'src/main/auditEventTypes.ts': "export type AuditEventType = 'extension.pairing.received'\n",
    })

    expect(evaluatePairingArchitecture(root).failures.join('\n')).toMatch(
      /auditEventTypes\.ts.*survive Community staging.*extension\.pairing/u,
    )
  })
})
