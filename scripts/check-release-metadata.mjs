import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'
import yaml from 'js-yaml'
import { communitySourceCiWorkflow, privateSourceCiWorkflow } from './check-source-ci.mjs'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const policy = JSON.parse(readFileSync(join(root, 'scripts/electron-support-policy.json'), 'utf8'))
const workflowActionPolicy = JSON.parse(
  readFileSync(join(root, 'scripts/workflow-action-policy.json'), 'utf8'),
)
const failures = []
const APPROVED_WORKFLOW_ACTIONS = new Map(Object.entries(workflowActionPolicy.actions ?? {}))
const CHECKOUT_ACTION = 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'
const PNPM_SETUP_ACTION = 'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271'
const NODE_SETUP_ACTION = 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e'
const PRIVATE_WORKFLOW_ALLOWLIST = new Set([
  'ci.yml',
  'extension-store-publish.yml',
  'extension-store-upload.yml',
  'release.yml',
])
const COMMUNITY_WORKFLOW_ALLOWLIST = new Set([
  'ci.yml',
  'community-release.yml',
])

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/

function parseVersion(value, label) {
  const match = String(value ?? '').match(SEMVER)
  if (!match) {
    failures.push(`${label} must be an explicit semantic version; found ${JSON.stringify(value)}`)
    return null
  }
  return match.slice(1, 4).map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

const appVersion = parseVersion(pkg.version, 'package.json version')
const electronRange = pkg.devDependencies?.electron
const declaredElectronMatch = String(electronRange ?? '').match(/(\d+\.\d+\.\d+)/)
const declaredElectron = declaredElectronMatch
  ? parseVersion(declaredElectronMatch[1], 'Electron dependency')
  : null

if (!declaredElectronMatch) {
  failures.push(`Electron dependency must include an explicit minimum version; found ${JSON.stringify(electronRange)}`)
}

const supportedMajors = policy.supportedMajors
if (
  !Array.isArray(supportedMajors) ||
  supportedMajors.length !== 3 ||
  !supportedMajors.every(Number.isInteger) ||
  supportedMajors.some((major, index) => index > 0 && major !== supportedMajors[index - 1] + 1)
) {
  failures.push('Electron support policy must list exactly three consecutive stable major versions')
}

const latestStable = parseVersion(policy.latestStable, 'Electron policy latestStable')
if (declaredElectron && supportedMajors?.length && !supportedMajors.includes(declaredElectron[0])) {
  failures.push(`Electron ${declaredElectron[0]} is outside the checked supported majors ${supportedMajors.join(', ')}`)
}
if (
  declaredElectron &&
  latestStable &&
  declaredElectron[0] === latestStable[0] &&
  compareVersions(declaredElectron, latestStable) < 0
) {
  failures.push(`Electron dependency ${declaredElectron.join('.')} is older than checked stable ${latestStable.join('.')}`)
}

const checkedAt = new Date(`${policy.checkedAt}T00:00:00.000Z`)
const policyAgeDays = (Date.now() - checkedAt.getTime()) / 86_400_000
if (!Number.isFinite(checkedAt.getTime()) || !Number.isInteger(policy.expiresAfterDays)) {
  failures.push('Electron support policy has invalid checkedAt or expiresAfterDays metadata')
} else if (policyAgeDays < -1) {
  failures.push('Electron support policy checkedAt is in the future')
} else if (policyAgeDays > policy.expiresAfterDays) {
  failures.push(
    `Electron support policy is ${Math.floor(policyAgeDays)} days old (limit ${policy.expiresAfterDays}); refresh it from ${policy.source}`,
  )
}

if (!/^pnpm@(?:1[1-9]|[2-9]\d)\.\d+\.\d+$/.test(String(pkg.packageManager ?? ''))) {
  failures.push('packageManager must pin pnpm 11 or newer so native SBOM generation is available')
}

if (!String(pkg.engines?.node ?? '').includes('22.12.0')) {
  failures.push('Node engine must require at least 22.12.0 for Electron 43 and the current Vite toolchain')
}

for (const unsupportedScript of ['dist:win', 'dist:all']) {
  if (pkg.scripts?.[unsupportedScript]) {
    failures.push(`${unsupportedScript} must stay absent until a supported Windows security and signing path exists`)
  }
}
const builderConfigPath = join(root, 'electron-builder.yml')
const builderConfig = existsSync(builderConfigPath) ? readFileSync(builderConfigPath, 'utf8') : ''
const productionBuilderConfigPath = join(root, 'electron-builder.production.yml')
const productionBuilderConfig = existsSync(productionBuilderConfigPath)
  ? readFileSync(productionBuilderConfigPath, 'utf8')
  : ''
const communityReleaseBuilderConfigPath = join(root, 'electron-builder.release.yml')
const communityReleaseBuilderConfig = existsSync(communityReleaseBuilderConfigPath)
  ? readFileSync(communityReleaseBuilderConfigPath, 'utf8')
  : ''
const communitySignedEvaluationBuilderConfigPath = join(root, 'electron-builder.signed-evaluation.yml')
const communitySignedEvaluationBuilderConfig = existsSync(communitySignedEvaluationBuilderConfigPath)
  ? readFileSync(communitySignedEvaluationBuilderConfigPath, 'utf8')
  : ''
const privateProductPackage = pkg.name !== 'vaultage-open-local'
let parsedBuilderConfig
try {
  parsedBuilderConfig = yaml.load(builderConfig)
} catch (error) {
  failures.push(`electron-builder.yml must be valid YAML: ${error instanceof Error ? error.message : String(error)}`)
}
if (privateProductPackage && parsedBuilderConfig) {
  if (parsedBuilderConfig.appId !== 'xyz.arcalab.vaultage') {
    failures.push('Private Vaultage packages must use the official xyz.arcalab.vaultage application identifier')
  }
  if (!Array.isArray(parsedBuilderConfig.publish) || parsedBuilderConfig.publish.length !== 0) {
    failures.push('Customer updates must remain fail-closed until an approved Arcalab binary-release channel replaces the empty publish list')
  }
}
if (/com\.eden\.vaultage|github\.com\/eden\/vaultapp|owner:\s*eden\b|repo:\s*vaultapp\b/u.test(builderConfig)) {
  failures.push('electron-builder.yml must not retain the legacy app identity or eden/vaultapp update channel')
}
if (/^(?:win|nsis):/m.test(builderConfig)) {
  failures.push('electron-builder.yml advertises an unsupported Windows installer target')
}
if (/browser-extension\/native-host|vaultage-extension-native-host|provider-pages\.json/u.test(builderConfig)) {
  failures.push('ordinary Electron packages must remain extension-host-free')
}
if (!privateProductPackage) {
  if (
    parsedBuilderConfig?.appId !== 'xyz.arcalab.vault-oc'
    || parsedBuilderConfig?.productName !== 'vault-OC'
    || parsedBuilderConfig?.publish !== null
    || parsedBuilderConfig?.mac?.notarize !== false
    || parsedBuilderConfig?.dmg?.sign !== false
  ) {
    failures.push('Community local builder config must keep the vault-OC identity, updater disabled, and signing/notarization off')
  }
  let parsedCommunityReleaseBuilder
  try {
    parsedCommunityReleaseBuilder = yaml.load(communityReleaseBuilderConfig)
  } catch (error) {
    failures.push(`electron-builder.release.yml must be valid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    !exactRecord(parsedCommunityReleaseBuilder, ['dmg', 'extends', 'mac'])
    || parsedCommunityReleaseBuilder.extends !== 'electron-builder.yml'
    || !exactRecord(parsedCommunityReleaseBuilder.mac, ['notarize'])
    || parsedCommunityReleaseBuilder.mac.notarize !== true
    || !exactRecord(parsedCommunityReleaseBuilder.dmg, ['sign'])
    || parsedCommunityReleaseBuilder.dmg.sign !== true
  ) {
    failures.push('Community release builder override must enable only notarization and DMG signing over the reviewed local config')
  }
  let parsedCommunitySignedEvaluationBuilder
  try {
    parsedCommunitySignedEvaluationBuilder = yaml.load(communitySignedEvaluationBuilderConfig)
  } catch (error) {
    failures.push(`electron-builder.signed-evaluation.yml must be valid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    !exactRecord(parsedCommunitySignedEvaluationBuilder, ['dmg', 'extends'])
    || parsedCommunitySignedEvaluationBuilder.extends !== 'electron-builder.yml'
    || !exactRecord(parsedCommunitySignedEvaluationBuilder.dmg, ['sign'])
    || parsedCommunitySignedEvaluationBuilder.dmg.sign !== true
  ) {
    failures.push('Community signed-evaluation builder override must enable only DMG signing over the unsigned, non-notarizing local config')
  }
  if (Object.values(pkg.scripts ?? {}).some(value =>
    String(value).includes('electron-builder.release.yml')
    || String(value).includes('electron-builder.signed-evaluation.yml')
  )) {
    failures.push('Community release builder override must remain CI-only and absent from package scripts')
  }
}
if (!privateProductPackage && (productionBuilderConfig || pkg.scripts?.['dist:mac:production'])) {
  failures.push('Community packages must not carry private production extension packaging')
} else if (privateProductPackage && !productionBuilderConfig) {
  failures.push('protected production Electron configuration is missing')
} else if (privateProductPackage) {
  let parsedProductionBuilder
  try {
    parsedProductionBuilder = yaml.load(productionBuilderConfig)
  } catch (error) {
    failures.push(`Production Electron configuration must be valid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsedProductionBuilder) {
    const resources = parsedProductionBuilder.mac?.extraResources ?? []
    const exactResource = (from, to) => resources.some(value => value?.from === from && value?.to === to)
    if (parsedProductionBuilder.extends !== 'electron-builder.yml') {
      failures.push('Production Electron configuration must extend the reviewed ordinary configuration')
    }
    if (Object.hasOwn(parsedProductionBuilder, 'appId') || Object.hasOwn(parsedProductionBuilder, 'publish')) {
      failures.push('Production Electron configuration must not override the reviewed official app identity or fail-closed publish channel')
    }
    if (!exactResource('resources/vaultage-extension-native-host', 'vaultage-extension-native-host')) {
      failures.push('Production Electron configuration must nest only the compiled Swift extension host at its fixed Resources path')
    }
    if (!exactResource('browser-extension/extension/provider-pages.json', 'browser-extension/extension/provider-pages.json')) {
      failures.push('Production Electron configuration must nest the exact sealed provider-page policy')
    }
    if (!parsedProductionBuilder.mac?.binaries?.includes('Contents/Resources/vaultage-extension-native-host')) {
      failures.push('Production Electron configuration must sign the Swift extension host as an additional binary')
    }
  }
  if (/browser-extension\/native-host(?:\/|\b)|vaultage-native-host\.mjs|install-chrome-host\.mjs|development-extension-identity/u.test(productionBuilderConfig)) {
    failures.push('Production Electron configuration must not package the Node host or development identity')
  }
}
if (privateProductPackage && (!pkg.scripts?.['dist:mac:production']?.includes('--config electron-builder.production.yml')
  || !pkg.scripts?.['dist:mac:production']?.includes('build-extension-native-host.sh --production'))) {
  failures.push('dist:mac:production must build the production Swift host and use the protected Electron configuration')
}

for (const candidate of ['.env', '.env.local', '.env.signing']) {
  const path = join(root, candidate)
  if (!existsSync(path) || process.platform === 'win32') continue
  const mode = statSync(path).mode & 0o777
  if ((mode & 0o077) !== 0) {
    failures.push(`${candidate} contains local configuration but has mode ${mode.toString(8)}; require 600 or stricter`)
  }
}

for (const agentFile of ['AGENTS.md', 'CLAUDE.md']) {
  const path = join(root, agentFile)
  if (!existsSync(path)) {
    failures.push(`${agentFile} must point agents to the canonical CI/CD policy`)
    continue
  }
  const value = readFileSync(path, 'utf8')
  if (!value.includes('docs/ci-cd.md')) {
    failures.push(`${agentFile} must reference docs/ci-cd.md`)
  }
}

const ciWorkflowPath = join(root, '.github/workflows/ci.yml')
const workflowsPath = join(root, '.github/workflows')
if (!privateProductPackage && existsSync(workflowsPath)) {
  const workflowEntries = readdirSync(workflowsPath, { withFileTypes: true })
  const unexpectedCommunityWorkflows = workflowEntries
    .filter(entry => !entry.isFile() || !COMMUNITY_WORKFLOW_ALLOWLIST.has(entry.name))
    .map(entry => entry.name)
  const exactCommunityWorkflow = workflowEntries.length === COMMUNITY_WORKFLOW_ALLOWLIST.size
    && unexpectedCommunityWorkflows.length === 0
  if (!exactCommunityWorkflow) {
    failures.push('Community packages must contain exactly the reviewed CI and Community release workflows')
  }
} else if (privateProductPackage && existsSync(workflowsPath)) {
  const unexpectedPrivateWorkflows = readdirSync(workflowsPath, { withFileTypes: true })
    .filter(entry => !entry.isFile() || !PRIVATE_WORKFLOW_ALLOWLIST.has(entry.name))
    .map(entry => entry.name)
  if (unexpectedPrivateWorkflows.length > 0) {
    failures.push(`Private workflow filename is outside the exact allowlist: ${unexpectedPrivateWorkflows.join(', ')}`)
  }
}
if (!existsSync(ciWorkflowPath)) {
  failures.push('CI workflow is missing')
} else {
  const workflow = readFileSync(ciWorkflowPath, 'utf8')
  validateWorkflowActionPins(workflow, 'CI workflow')
  let parsedCiWorkflow
  try {
    parsedCiWorkflow = yaml.load(workflow)
  } catch {
    // validateWorkflowActionPins reports the invalid workflow YAML.
  }
  validateRoutineCiWorkflow(parsedCiWorkflow, workflow, { privateProductPackage })
  const exactWorkflow = privateProductPackage ? privateSourceCiWorkflow() : communitySourceCiWorkflow()
  if (workflow !== exactWorkflow) failures.push('Routine CI workflow bytes must match the canonical source-only policy')
  if (!exactRecord(parsedCiWorkflow?.permissions, ['contents'])
    || parsedCiWorkflow.permissions.contents !== 'read') {
    failures.push('CI workflow must declare exactly read-only top-level contents permission')
  }
  for (const [label, required] of [
    ['portable Linux release gate', 'runs-on: ubuntu-24.04'],
    ['stale-run cancellation', 'cancel-in-progress: true'],
  ]) {
    if (!workflow.includes(required)) failures.push(`CI workflow is missing the ${label}`)
  }
  validateRequiredReleaseGate(parsedCiWorkflow, privateProductPackage ? {
    jobName: 'portable-release-gates',
    stepName: 'Release gates',
    command: 'pnpm verify:release:portable',
    label: 'private portable',
  } : {
    jobName: 'community-release-gate',
    stepName: 'Verify Community source',
    command: 'pnpm verify:release',
    label: 'Community',
  })
  if (/runs-on:\s*macos-/u.test(workflow) || workflow.includes('pnpm verify:release:macos')) {
    failures.push('Routine CI must remain Linux-only; run the macOS release boundary locally')
  }
  const routineJobs = parsedCiWorkflow?.jobs
  if (!routineJobs || typeof routineJobs !== 'object' || Array.isArray(routineJobs)) {
    failures.push('Routine CI must define a jobs mapping')
  } else {
    for (const [jobName, job] of Object.entries(routineJobs)) {
      if (!job || typeof job !== 'object' || Array.isArray(job)) {
        failures.push(`Routine CI job ${jobName} must be a job mapping`)
        continue
      }
      if (job['runs-on'] !== 'ubuntu-24.04') {
        failures.push(`Routine CI job ${jobName} must run exactly on ubuntu-24.04`)
      }
      const timeoutMinutes = job['timeout-minutes']
      if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 15) {
        failures.push(`Routine CI job ${jobName} must set timeout-minutes to an integer from 1 through 15`)
      }
      if (job.strategy && Object.hasOwn(job.strategy, 'matrix')) {
        failures.push(`Routine CI job ${jobName} must not use a matrix strategy`)
      }
      if (Object.hasOwn(job, 'permissions')) {
        failures.push(`Routine CI job ${jobName} must not override workflow permissions`)
      }
    }
  }
  const checkoutCount = (workflow.match(/uses: actions\/checkout@[a-f0-9]{40}\b/gu) ?? []).length
  const nonPersistingCheckoutCount = (
    workflow.match(/uses: actions\/checkout@[a-f0-9]{40}\b[\s\S]{0,160}?persist-credentials: false/gu) ?? []
  ).length
  if (checkoutCount === 0 || nonPersistingCheckoutCount !== checkoutCount) {
    failures.push('every CI checkout must be SHA-pinned and disable persisted credentials')
  }
}

const communityReleaseWorkflowPath = join(root, '.github/workflows/community-release.yml')
if (!privateProductPackage) {
  if (!existsSync(communityReleaseWorkflowPath)) {
    failures.push('Community release workflow is missing')
  } else {
    const workflow = readFileSync(communityReleaseWorkflowPath, 'utf8')
    validateWorkflowActionPins(workflow, 'Community release workflow')
    let parsedWorkflow
    try {
      parsedWorkflow = yaml.load(workflow)
    } catch {
      // validateWorkflowActionPins reports the invalid workflow YAML.
    }
    validateCommunityReleaseWorkflow(parsedWorkflow, workflow)
  }
}

const releaseWorkflowPath = join(root, '.github/workflows/release.yml')
if (privateProductPackage && existsSync(releaseWorkflowPath)) {
  const workflow = readFileSync(releaseWorkflowPath, 'utf8')
  validateWorkflowActionPins(workflow, 'Release workflow')
  let parsedReleaseWorkflow
  try {
    parsedReleaseWorkflow = yaml.load(workflow)
  } catch {
    // validateWorkflowActionPins already reports the parse error.
  }
  const requiredWorkflowControls = [
    ['full checkout for ancestry checks', 'fetch-depth: 0'],
    ['protected release environment', 'environment: production-release'],
    ['main-ancestry enforcement', 'VAULTAGE_REQUIRE_RELEASE_MAIN_ANCESTRY'],
    ['private source-repository enforcement', 'REPOSITORY_VISIBILITY'],
    ['packaged entitlement smoke', 'pnpm smoke:mac-entitlements'],
    ['packaged launch smoke', 'pnpm smoke:packaged-app'],
    ['notarization staple validation', 'xcrun stapler validate'],
    ['locked dependency SBOM', 'pnpm sbom:generate'],
    ['packaged artifact SBOM', 'anchore/sbom-action@'],
    ['mandatory paid-release profile', 'VAULTAGE_COMMERCIAL_RELEASE_CONFIG_B64'],
    ['mandatory Control compatibility evidence', 'VAULTAGE_CONTROL_RELEASE_EVIDENCE_B64'],
    ['backend-first compatibility gate', 'check-control-release-evidence.mjs'],
    ['pinned Control reviewer keyring', 'control-release-reviewers.json'],
    ['production paid-release mode', 'VAULTAGE_COMMERCIAL_RELEASE_MODE: production'],
    ['production Swift host package target', 'pnpm dist:mac:production'],
    ['paid-release profile digest', 'commercial-release-profile.sha256'],
    ['Control compatibility evidence digest', 'control-release-evidence.sha256'],
    ['packaged extension native-host digest', 'browser-extension-native-host.sha256'],
    ['protected production browser extension identity', 'vars.VAULTAGE_EXTENSION_PRODUCTION_ID'],
    ['deterministic Store browser extension candidate', 'pnpm extension:build:production'],
    ['Store browser extension artifact verification', 'pnpm check:browser-extension-artifact:production'],
    ['authenticated official Store observation', 'VAULTAGE_EXTENSION_STORE_OBSERVATION_B64'],
    ['cross-artifact Store identity receipt', 'check-extension-store-release.mjs'],
    ['restricted Store candidate retention', 'extension-store-candidate-restricted-${{ github.sha }}'],
    ['restricted Store retention period', 'retention-days: 14'],
    ['exact Store ZIP attestation', 'Attest exact restricted Store ZIP provenance'],
    ['downloaded DMG mount acceptance', 'Mount and accept the exact downloaded DMG'],
    ['downloaded DMG byte receipt', 'verify-downloaded-mac-artifact.mjs'],
    ['build-stage app and DMG digest record', 'record-packaged-mac-artifact.mjs'],
    ['downloaded DMG staple check', 'xcrun stapler validate "$DMG"'],
    ['non-persisted release checkout credential', 'persist-credentials: false'],
  ]
  for (const [label, marker] of requiredWorkflowControls) {
    if (!workflow.includes(marker)) failures.push(`Release workflow is missing ${label}`)
  }
  const publicReleaseSection = workflow.slice(workflow.lastIndexOf('uses: softprops/action-gh-release@'))
  if (/(?:browser-extension\/|vaultage-browser-extension|extension-store-candidate)|(?:dist|artifacts)\/\*\*/m.test(publicReleaseSection)) {
    failures.push('Release workflow must validate but not distribute the Store browser extension candidate')
  }
  if (parsedReleaseWorkflow) validateReleaseArtifactCustody(parsedReleaseWorkflow)
  if (/anchore\/sbom-action@(?![a-f0-9]{40}\b)/.test(workflow)) {
    failures.push('Release workflow must pin anchore/sbom-action to a full commit SHA')
  }
}

function validateCommunityReleaseWorkflow(workflow, source) {
  if (!exactRecord(workflow, ['concurrency', 'jobs', 'name', 'on', 'permissions'])
    || workflow.name !== 'Community macOS release') {
    failures.push('Community release workflow must use the exact reviewed top-level control inventory')
    return
  }
  const dispatch = workflow.on?.workflow_dispatch
  const inputs = dispatch?.inputs
  if (
    !exactRecord(workflow.on, ['workflow_dispatch'])
    || !exactRecord(dispatch, ['inputs'])
    || !exactRecord(inputs, ['release_commit', 'release_mode', 'release_tag'])
    || !exactRecord(inputs.release_commit, ['description', 'required', 'type'])
    || !exactRecord(inputs.release_mode, ['default', 'description', 'options', 'required', 'type'])
    || !exactRecord(inputs.release_tag, ['description', 'required', 'type'])
    || inputs.release_commit.required !== true
    || inputs.release_commit.type !== 'string'
    || inputs.release_mode.default !== 'signed-evaluation'
    || !exactArray(inputs.release_mode.options, ['signed-evaluation', 'notarized'])
    || inputs.release_mode.required !== true
    || inputs.release_mode.type !== 'choice'
    || inputs.release_tag.required !== true
    || inputs.release_tag.type !== 'string'
  ) {
    failures.push('Community release workflow must expose only explicit signed-evaluation and notarized manual modes')
  }
  if (!exactRecord(workflow.permissions, ['contents']) || workflow.permissions.contents !== 'read') {
    failures.push('Community release workflow must default to read-only repository contents')
  }
  if (
    !exactRecord(workflow.concurrency, ['cancel-in-progress', 'group'])
    || workflow.concurrency.group !== 'community-release'
    || workflow.concurrency['cancel-in-progress'] !== false
  ) {
    failures.push('Community release workflow must serialize candidates without cancelling an active release')
  }

  const jobs = workflow.jobs
  const expectedJobs = [
    'build-sign-and-accept-community-macos',
    'prepare-community-source',
    'publish-community-release',
  ]
  if (!exactRecord(jobs, expectedJobs)) {
    failures.push(`Community release workflow must define only the exact jobs: ${expectedJobs.join(', ')}`)
    return
  }
  const prepare = jobs['prepare-community-source']
  const build = jobs['build-sign-and-accept-community-macos']
  const publish = jobs['publish-community-release']
  if (prepare?.['runs-on'] !== 'ubuntu-24.04' || prepare?.['timeout-minutes'] !== 30) {
    failures.push('Community release preflight must run on bounded Ubuntu')
  }
  const prepareSteps = Array.isArray(prepare?.steps) ? prepare.steps : []
  const bindingIndex = prepareSteps.findIndex(
    step => step?.name === 'Verify the exact reviewed Community main and tag candidate',
  )
  const installIndex = prepareSteps.findIndex(step => step?.name === 'Install Community dependencies')
  const releaseGateIndex = prepareSteps.findIndex(step => step?.name === 'Verify Community source on Linux')
  const expectedPrepareTail = [
    actionStep(PNPM_SETUP_ACTION, { version: '11.11.0' }),
    actionStep(NODE_SETUP_ACTION, { 'node-version': 24, cache: 'pnpm' }),
    namedRunStep('Install Community dependencies', 'pnpm install --frozen-lockfile'),
    namedRunStep('Verify Community source on Linux', 'pnpm verify:release'),
  ]
  const exactPrepareCheckout = actionStep(CHECKOUT_ACTION, {
    ref: '${{ inputs.release_commit }}',
    'fetch-depth': 0,
    'persist-credentials': false,
  })
  const bindingStep = prepareSteps[1]
  const bindingRun = String(bindingStep?.run ?? '')
  if (
    prepareSteps.length !== 6
    || !deepExact(prepareSteps[0], exactPrepareCheckout)
    || bindingIndex !== 1
    || !exactRecord(bindingStep, ['env', 'name', 'run'])
    || !exactRecord(bindingStep?.env, ['RELEASE_COMMIT', 'RELEASE_MODE', 'RELEASE_TAG'])
    || bindingStep.env.RELEASE_COMMIT !== '${{ inputs.release_commit }}'
    || bindingStep.env.RELEASE_MODE !== '${{ inputs.release_mode }}'
    || bindingStep.env.RELEASE_TAG !== '${{ inputs.release_tag }}'
    || !expectedPrepareTail.every((step, index) => deepExact(prepareSteps[index + 2], step))
    || installIndex !== 4
    || releaseGateIndex !== 5
  ) {
    failures.push('Community release preflight must use the exact checkout, binding, setup, install, and gate order')
  }
  for (const marker of [
    'test "$GITHUB_REPOSITORY" = "VAULTAGE01/Vaultage"',
    'test "$GITHUB_REF" = "refs/heads/main"',
    'test "$GITHUB_SHA" = "$RELEASE_COMMIT"',
    'test "${#RELEASE_COMMIT}" -eq 40',
    'git check-ref-format "refs/tags/$RELEASE_TAG"',
    'git fetch --force origin refs/heads/main',
    'test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"',
    'test "$(git rev-parse --verify "$RELEASE_TAG^{commit}")" = "$RELEASE_COMMIT"',
    'test "$(git rev-parse origin/main)" = "$RELEASE_COMMIT"',
    'test "$RELEASE_TAG" = "v$(node -p \'require("./package.json").version\')"',
    'case "$RELEASE_MODE" in',
    'signed-evaluation|notarized)',
    'test -z "$(git status --porcelain)"',
  ]) {
    if (!bindingRun.includes(marker)) {
      failures.push(`Community release preflight binding step is missing: ${marker}`)
    }
  }
  if (
    build?.['runs-on'] !== 'macos-14'
    || build?.['timeout-minutes'] !== 45
    || build?.environment !== 'community-release'
    || !exactArray(build?.needs, ['prepare-community-source'])
  ) {
    failures.push('Community signing must be one bounded protected macOS job after Linux preflight')
  }
  const buildSteps = Array.isArray(build?.steps) ? build.steps : []
  const packageIndex = buildSteps.findIndex(
    step => step?.name === 'Build and sign the universal Community app and DMG',
  )
  const evaluationLabelIndex = buildSteps.findIndex(
    step => step?.name === 'Label signed evaluation DMG as not notarized',
  )
  const notarizeIndex = buildSteps.findIndex(
    step => step?.name === 'Notarize and staple the exact Community DMG',
  )
  const recordIndex = buildSteps.findIndex(
    step => step?.name === 'Record the exact built Community artifact',
  )
  const evaluationLabelStep = buildSteps[evaluationLabelIndex]
  const notarizeStep = buildSteps[notarizeIndex]
  const notarizeRun = String(notarizeStep?.run ?? '')
  if (
    packageIndex < 0
    || evaluationLabelIndex <= packageIndex
    || notarizeIndex <= evaluationLabelIndex
    || evaluationLabelStep?.if !== "${{ inputs.release_mode == 'signed-evaluation' }}"
    || notarizeStep?.if !== "${{ inputs.release_mode == 'notarized' }}"
    || ![
      'BUILDER_CONFIG=electron-builder.signed-evaluation.yml',
      'BUILDER_CONFIG=electron-builder.release.yml',
      '--config "$BUILDER_CONFIG"',
      '-SIGNED-EVALUATION-NOT-NOTARIZED.dmg',
    ].every(marker => source.includes(marker))
  ) {
    failures.push('Community release workflow must keep signed-evaluation signing separate from the notarized path')
  }
  if (
    recordIndex <= notarizeIndex
    || !exactRecord(notarizeStep, ['env', 'if', 'name', 'run'])
    || notarizeStep?.if !== "${{ inputs.release_mode == 'notarized' }}"
    || !deepExact(notarizeStep?.env, {
      APPLE_ID: '${{ secrets.APPLE_ID }}',
      APPLE_APP_SPECIFIC_PASSWORD: '${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}',
      APPLE_TEAM_ID: '${{ secrets.APPLE_TEAM_ID }}',
    })
    || ![
      'DMG="$(node scripts/select-exact-release-dmg.mjs dist)"',
      'xcrun notarytool submit "$DMG" \\',
      '--apple-id "$APPLE_ID"',
      '--password "$APPLE_APP_SPECIFIC_PASSWORD"',
      '--team-id "$APPLE_TEAM_ID"',
      '--wait',
      'xcrun stapler staple "$DMG"',
      'xcrun stapler validate "$DMG"',
    ].every(marker => notarizeRun.includes(marker))
  ) {
    failures.push('Community release workflow must explicitly notarize and staple the selected DMG before recording it')
  }
  const downloadedAcceptanceStep = buildSteps.find(
    step => step?.name === 'Mount and accept the exact downloaded Community DMG',
  )
  const downloadedAcceptanceRun = String(downloadedAcceptanceStep?.run ?? '')
  if (
    ![
      'notarized)',
      'xcrun stapler validate "$DMG"',
      'signed-evaluation)',
      '*-SIGNED-EVALUATION-NOT-NOTARIZED.dmg)',
      'releaseMode: process.env.RELEASE_MODE',
      "notarized: process.env.RELEASE_MODE === 'notarized'",
    ].every(marker => downloadedAcceptanceRun.includes(marker))
  ) {
    failures.push('Community release workflow must preserve final staple validation for the downloaded DMG')
  }
  if (
    publish?.['runs-on'] !== 'ubuntu-24.04'
    || publish?.['timeout-minutes'] !== 15
    || !exactArray(publish?.needs, ['build-sign-and-accept-community-macos'])
    || !exactRecord(publish?.permissions, ['attestations', 'contents', 'id-token'])
    || publish.permissions.attestations !== 'write'
    || publish.permissions.contents !== 'write'
    || publish.permissions['id-token'] !== 'write'
  ) {
    failures.push('Community publication must be a bounded Ubuntu job with only provenance and same-repository release authority')
  }

  const requiredMarkers = [
    ['exact current-main dispatch', 'test "$GITHUB_SHA" = "$RELEASE_COMMIT"'],
    ['exact tag/package version binding', 'test "$RELEASE_TAG" = "v$(node -p'],
    ['protected release environment', 'environment: community-release'],
    ['private CI-only builder override', 'BUILDER_CONFIG=electron-builder.release.yml'],
    ['signed-evaluation CI-only builder override', 'BUILDER_CONFIG=electron-builder.signed-evaluation.yml'],
    ['actual Community app bundle name', 'dist/mac-universal/vault-OC.app'],
    ['mounted Community app bundle name', 'APP="$MOUNT/vault-OC.app"'],
    ['signed app and DMG acceptance record', 'record-packaged-mac-artifact.mjs'],
    ['downloaded DMG mount acceptance', 'Mount and accept the exact downloaded Community DMG'],
    ['locked dependency SBOM', 'pnpm sbom:generate'],
    ['packaged app SBOM', 'anchore/sbom-action@'],
    ['public artifact attestation', 'actions/attest-build-provenance@'],
    ['canonical checksum filename', 'SHA256SUMS'],
    ['same-repository GitHub token', 'GH_TOKEN: ${{ github.token }}'],
    ['non-persisted checkout credentials', 'persist-credentials: false'],
  ]
  for (const [label, marker] of requiredMarkers) {
    if (!source.includes(marker)) failures.push(`Community release workflow is missing ${label}`)
  }
  if (![
    '-SIGNED-EVALUATION-NOT-NOTARIZED.dmg',
    'community-mac-release-${{ inputs.release_mode }}-${{ inputs.release_commit }}',
    'SIGNED EVALUATION — NOT NOTARIZED',
    'releaseMode: process.env.RELEASE_MODE',
    "notarized: process.env.RELEASE_MODE === 'notarized'",
  ].every(marker => source.includes(marker))) {
    failures.push('Signed evaluation releases must be unmistakably labeled as not notarized')
  }
  for (const forbidden of [
    'VAULTAGE_COMMUNITY_RELEASE_TOKEN',
    'repository: VAULTAGE01/Vaultage',
    'Vaultage.app',
    'SHASUMS256.txt',
    'latest-mac.yml',
  ]) {
    if (source.includes(forbidden)) {
      failures.push(`Community release workflow contains forbidden legacy or cross-repository term: ${forbidden}`)
    }
  }
  const checkoutCount = (source.match(/uses: actions\/checkout@[a-f0-9]{40}\b/gu) ?? []).length
  const nonPersistingCheckoutCount = (
    source.match(/uses: actions\/checkout@[a-f0-9]{40}\b[\s\S]{0,220}?persist-credentials: false/gu) ?? []
  ).length
  if (checkoutCount !== 3 || nonPersistingCheckoutCount !== checkoutCount) {
    failures.push('Community release workflow must use exactly three non-persisting exact-ref checkouts')
  }
}

function validateReleaseArtifactCustody(workflow) {
  const buildSteps = workflow.jobs?.['build-mac']?.steps ?? []
  const restrictedUpload = buildSteps.find(step =>
    String(step?.uses ?? '').startsWith('actions/upload-artifact@')
    && step?.with?.name === 'extension-store-candidate-restricted-${{ github.sha }}'
  )
  const exactRestrictedPaths = [
    'dist/browser-extension/*-store.zip',
    'dist/browser-extension/*-store.zip.sha256',
    'dist/browser-extension/*-store.zip.provenance.json',
    'dist/browser-extension/store-release-receipt.json',
  ]
  const retainedPaths = String(restrictedUpload?.with?.path ?? '').trim().split(/\r?\n/u).filter(Boolean)
  if (
    !restrictedUpload
    || Number(restrictedUpload.with?.['retention-days']) !== 14
    || restrictedUpload.with?.['if-no-files-found'] !== 'error'
    || retainedPaths.length !== exactRestrictedPaths.length
    || exactRestrictedPaths.some(path => !retainedPaths.includes(path))
  ) {
    failures.push('Release workflow must retain only the exact restricted Store candidate evidence for 14 days')
  }

  const releaseSteps = workflow.jobs?.release?.steps ?? []
  const downloads = releaseSteps.filter(step => String(step?.uses ?? '').startsWith('actions/download-artifact@'))
  const exactDownloads = new Map([
    ['mac-dmg', 'artifacts/mac-dmg'],
    ['mac-dmg-acceptance', 'artifacts/mac-dmg-acceptance'],
  ])
  if (
    downloads.length !== exactDownloads.size
    || downloads.some(step => exactDownloads.get(step?.with?.name) !== step?.with?.path)
  ) {
    failures.push('Public release job must download only the named mac-dmg and mac-dmg-acceptance artifacts')
  }
}

function validateWorkflowActionPins(workflow, label) {
  let parsedWorkflow
  try {
    parsedWorkflow = yaml.load(workflow)
  } catch (error) {
    failures.push(`${label} must be valid YAML: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const parsedActionValues = []
  collectWorkflowActionValues(parsedWorkflow, parsedActionValues)
  const actionLines = workflow.match(/^\s*(?:-\s*)?uses:\s*\S+.*$/gmu) ?? []
  if (parsedActionValues.length !== actionLines.length) {
    failures.push(`${label} must express every external action as a canonical block-style uses line`)
  }
  if (parsedActionValues.length === 0) {
    failures.push(`${label} must use at least one approved action`)
    return
  }

  for (const value of parsedActionValues) {
    const match = value.match(/^([^@\s]+)@([a-f0-9]{40})$/u)
    if (!match) {
      failures.push(`${label} must pin every external action to a full commit SHA`)
      continue
    }
    const approvedSha = APPROVED_WORKFLOW_ACTIONS.get(match[1])
    if (!approvedSha) {
      failures.push(`${label} uses an action outside the reviewed allowlist: ${match[1]}`)
    } else if (match[2] !== approvedSha) {
      failures.push(`${label} uses an unreviewed commit for ${match[1]}: ${match[2]}`)
    }
  }
}

function collectWorkflowActionValues(value, actions) {
  if (Array.isArray(value)) {
    for (const item of value) collectWorkflowActionValues(item, actions)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'uses') {
      actions.push(typeof item === 'string' ? item.trim() : '')
    }
    collectWorkflowActionValues(item, actions)
  }
}

function validateRoutineCiWorkflow(workflow, source, { privateProductPackage }) {
  if (!exactRecord(workflow, ['name', 'on', 'permissions', 'concurrency', 'jobs']) || workflow.name !== 'CI') {
    failures.push('Routine CI must use the exact canonical top-level source-check workflow inventory')
  }

  const expectedPushBranches = ['main']
  const triggers = workflow?.on
  if (!exactRecord(triggers, ['pull_request', 'push'])
    || triggers.pull_request !== null
    || !exactRecord(triggers.push, ['branches'])
    || !exactArray(triggers.push.branches, expectedPushBranches)) {
    failures.push(`Routine CI must run only for pull requests and pushes to ${expectedPushBranches.join('/')}`)
  }

  if (!exactRecord(workflow?.concurrency, ['cancel-in-progress', 'group'])
    || workflow.concurrency.group !== 'ci-${{ github.workflow }}-${{ github.ref }}'
    || workflow.concurrency['cancel-in-progress'] !== true) {
    failures.push('Routine CI must use the exact stale-run cancellation policy')
  }

  if (/\$\{\{\s*(?:secrets|vars)\b/iu.test(source)) {
    failures.push('Routine CI must not read GitHub secrets or variables')
  }
  if (/^\s*(?:-\s*)?["'](?:name|on|push|branches|pull_request|permissions|contents|concurrency|group|cancel-in-progress|jobs|runs-on|timeout-minutes|steps|uses|with|version|node-version|cache|shell|run|environment|env|id-token|strategy|matrix|if|continue-on-error)["']\s*:/mu
    .test(source)
    || /^\s*-\s*[\[{]/mu.test(source)
    || /^\s*[A-Za-z0-9_-]+\s*:\s*[\[{]/mu.test(source)
    || /^\s*(?:-\s*)?(?:[A-Za-z0-9_-]+\s*:\s*)?[&*][A-Za-z0-9_-]+\s*$/mu.test(source)) {
    failures.push('Routine CI must use canonical block YAML without quoted control keys, flow collections, anchors, or aliases')
  }

  const jobs = workflow?.jobs
  const expectedJobs = privateProductPackage
    ? ['open-source-gates', 'portable-release-gates']
    : ['community-release-gate']
  if (!exactRecord(jobs, expectedJobs)) {
    failures.push(`Routine CI must define only the exact jobs: ${expectedJobs.join(', ')}`)
    return
  }

  const expectedByJob = privateProductPackage
    ? {
        'portable-release-gates': privateRoutineSteps([
          namedRunStep('Install dependencies', 'pnpm install --frozen-lockfile'),
          namedRunStep('Linear roadmap integrity tests', 'pnpm test:linear-roadmap'),
          namedRunStep('Release gates', 'pnpm verify:release:portable'),
        ]),
        'open-source-gates': privateRoutineSteps([
          namedRunStep('Install dependencies', 'pnpm install --frozen-lockfile'),
          namedRunStep('Verify public Vault + Projects source drop', 'pnpm verify:open-source-stage'),
        ]),
      }
    : {
        'community-release-gate': communityRoutineSteps(),
      }

  for (const jobName of expectedJobs) {
    const job = jobs[jobName]
    const expectedSteps = expectedByJob[jobName]
    if (!exactRecord(job, ['runs-on', 'steps', 'timeout-minutes'])
      || job['runs-on'] !== 'ubuntu-24.04'
      || job['timeout-minutes'] !== 15
      || !Array.isArray(job.steps)
      || job.steps.length !== expectedSteps.length
      || job.steps.some((step, index) => !deepExact(step, expectedSteps[index]))) {
      failures.push(`Routine CI job ${jobName} must use the exact reviewed action, input, and command inventory`)
    }
  }
}

function privateRoutineSteps(finalSteps) {
  return [
    actionStep(CHECKOUT_ACTION, { 'persist-credentials': false }),
    namedRunStep('Verify source-CI policy before dependency execution', 'node scripts/check-source-ci.mjs'),
    actionStep(PNPM_SETUP_ACTION, { version: '11.11.0' }),
    actionStep(NODE_SETUP_ACTION, { 'node-version': 24, cache: 'pnpm' }),
    ...finalSteps,
  ]
}

function communityRoutineSteps() {
  return [
    actionStep(CHECKOUT_ACTION, { 'persist-credentials': false }),
    namedRunStep('Verify source-CI policy before dependency execution', 'node scripts/check-source-ci.mjs'),
    actionStep(PNPM_SETUP_ACTION, { version: '11.11.0' }),
    actionStep(NODE_SETUP_ACTION, { 'node-version': 24, cache: 'pnpm' }),
    namedRunStep('Install dependencies', 'pnpm install --frozen-lockfile'),
    namedRunStep('Verify Community source', 'pnpm verify:release'),
  ]
}

function actionStep(uses, withInputs) {
  return { uses, with: withInputs }
}

function namedRunStep(name, run) {
  return { name, run }
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index])
}

function deepExact(value, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(value)
      && value.length === expected.length
      && value.every((item, index) => deepExact(item, expected[index]))
  }
  if (expected === null || typeof expected !== 'object') return value === expected
  return exactRecord(value, Object.keys(expected))
    && Object.entries(expected).every(([key, item]) => deepExact(value[key], item))
}

function validateRequiredReleaseGate(workflow, { jobName, stepName, command, label }) {
  const jobs = workflow?.jobs
  const job = jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? jobs[jobName] : null
  if (!job || typeof job !== 'object' || Array.isArray(job) || !Array.isArray(job.steps)) {
    failures.push(`CI workflow is missing the canonical ${label} release gate job ${jobName}`)
    return
  }
  if (Object.hasOwn(job, 'if') || Object.hasOwn(job, 'continue-on-error')) {
    failures.push(`CI workflow ${label} release gate job must be unconditional and blocking`)
  }
  const matchingSteps = job.steps.filter(step => step?.name === stepName)
  const step = matchingSteps.length === 1 ? matchingSteps[0] : null
  if (step && (Object.hasOwn(step, 'if') || Object.hasOwn(step, 'continue-on-error'))) {
    failures.push(`CI workflow ${label} release command step must be unconditional and blocking`)
  }
  if (!exactRecord(step, ['name', 'run']) || step.run !== command) {
    failures.push(`CI workflow is missing the exact canonical ${label} release command step`)
  }
}

function exactRecord(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

const refType = process.env.GITHUB_REF_TYPE
const refName = process.env.GITHUB_REF_NAME
const tagName = refType === 'tag'
  ? refName
  : process.env.GITHUB_REF?.startsWith('refs/tags/')
    ? process.env.GITHUB_REF.slice('refs/tags/'.length)
    : null
if (tagName && tagName !== `v${pkg.version}`) {
  failures.push(`Release tag ${tagName} does not match package version v${pkg.version}`)
}

if (process.env.VAULTAGE_REQUIRE_RELEASE_MAIN_ANCESTRY === '1') {
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' })
  if (shallow.status !== 0 || shallow.stdout.trim() === 'true') {
    failures.push('Release ancestry validation requires a full git checkout')
  } else {
    const mainRef = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], { cwd: root })
    if (mainRef.status !== 0) {
      failures.push('Release ancestry validation could not find origin/main')
    } else {
      const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd: root })
      if (ancestry.status !== 0) failures.push('Release tag commit is not reachable from origin/main')
    }
  }
}

if (!appVersion) failures.push('Application version could not be validated')

if (failures.length > 0) {
  console.error('Release metadata checks failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`Release metadata passed: Vaultage ${pkg.version}, Electron ${declaredElectron.join('.')}.`)
