import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const failures = []
const privateTree = existsSync(join(root, 'src/shared/commercialPolicy.ts'))

function read(path) {
  const absolute = join(root, path)
  if (!existsSync(absolute)) {
    failures.push(`${path}: required product-truth input is missing`)
    return ''
  }
  return readFileSync(absolute, 'utf8')
}

function requireMatch(path, source, pattern, description) {
  if (!pattern.test(source)) failures.push(`${path}: ${description}`)
}

function forbid(path, source, pattern, description) {
  if (pattern.test(source)) failures.push(`${path}: ${description}`)
}

function forbidCurrentTierContradictions(path, source) {
  forbid(
    path,
    source,
    /\b(?:two|2)\s+(?:user-selected\s+)?active\s+(?:local\s+)?Projects?\b/iu,
    'must not impose a two-Project Free limit',
  )
  forbid(
    path,
    source,
    /(?:at most|up to|only|limited to|falls? back to)\s+(?:two|2)\s+(?:user-selected\s+)?(?:active\s+)?(?:local\s+)?Projects?\b/iu,
    'must not express a numeric Free Project limit',
  )
  forbid(
    path,
    source,
    /\bFree active limit\b|selects?\s+which\s+(?:two|2)\s+are\s+active\b|inactive\s+Projects?\s+cannot\s+(?:be\s+rescanned|receive\s+new\s+mappings)/iu,
    'must not preserve the retired active-Project selection policy',
  )
  forbid(
    path,
    source,
    /(?:target paid-beta set|paid beta grants|Pro adds|Pro enables|Pro includes)[^.;\n]{0,180}(?:Agent|Agent\/CLI)|(?:paid|Pro)\s+Agent\b|Agent(?:\s*\/\s*CLI)?[^.\n]{0,120}(?:requires?\s+(?:an?\s+)?(?:active\s+)?(?:Trial|Pro)|(?:is|remains)\s+(?:an?\s+)?paid (?:capability|entitlement))/iu,
    'must not claim that Agent requires paid access',
  )
  forbid(
    path,
    source,
    /(?:target paid-beta set|paid beta grants|Pro adds|Pro enables|Pro includes)[^.;\n]{0,220}(?:browser[- ]extension|extension workflows)|browser[- ]extension[^.\n]{0,120}(?:Trial\s*\+\s*Pro|(?:is|as)\s+(?:an?\s+)?released paid capability|paid entitlement)/iu,
    'must not claim that the browser extension is released with paid access',
  )
  forbid(
    path,
    source,
    /Close\s+browser[- ]extension[^.\n]{0,180}acceptance\s+gates\s+for\s+the\s+exact\s+candidate/iu,
    'must not put the deferred browser extension on the current release critical path',
  )
}

function requireCurrentTierSemantics(path, source) {
  requireMatch(
    path,
    source,
    /unlimited\s+(?:active\s+)?(?:local\s+)?Projects/iu,
    'must state that Projects are unlimited',
  )
  requireMatch(
    path,
    source,
    /(?:Closed\s+)?Free[\s\S]{0,240}(?:Agent|Agent\/CLI)|(?:Agent|Agent\/CLI)[\s\S]{0,240}(?:Closed\s+)?Free/iu,
    'must state that Agent is included on closed Free',
  )
  requireMatch(
    path,
    source,
    /(?:sole|only)[\s\S]{0,120}(?:released\s+)?paid capability[\s\S]{0,140}(?:Services|pro\.services)|Pro(?:\s+activation)?\s+adds[^\n]{0,100}Services[^\n]{0,40}only/iu,
    'must state that Services is the only released paid capability',
  )
  requireMatch(
    path,
    source,
    /browser[- ]extension[\s\S]{0,160}(?:deferred|unavailable)|(?:deferred|unavailable)[\s\S]{0,160}browser[- ]extension/iu,
    'must state that the browser extension is deferred or unavailable',
  )
  forbidCurrentTierContradictions(path, source)
}

// These documents are current release-contract documentation. Historical
// changelogs, source-provenance records, and dedicated deferred-extension
// design tracks preserve past work and are intentionally outside this scan.
const CURRENT_CANONICAL_TIER_DOCS = [
  'PLAN.md',
  'README.md',
  'SECURITY.md',
  'docs/product.md',
  'docs/foundation.md',
  'docs/features.md',
  'docs/architecture.md',
  'docs/backend-paid-beta-profile.md',
  'docs/repo-structure.md',
  'docs/current-state.md',
  'docs/governance.md',
  'docs/decisions.md',
  'marketing-web/src/App.tsx',
]

// ADR-023 records a superseded boundary decision. Preserve it as history while
// keeping it out of assertions about the current release contract.
function withoutSupersededTierHistory(path, source) {
  if (path !== 'docs/decisions.md') return source
  return source.replace(/## ADR-023[\s\S]*?(?=## ADR-024)/u, '')
}

const product = read('docs/product.md')
const features = read('docs/features.md')

requireMatch(
  'docs/product.md',
  product,
  /Community[\s\S]{0,360}(?:accountless|does not require an account|Account[^\n|]*None)/iu,
  'must state that Community is accountless',
)
requireMatch(
  'docs/product.md',
  product,
  /no\s+(?:commercial\s+)?active-project\s+limit/iu,
  'must state that Community is accountless and has no active-project limit',
)

if (privateTree) {
  const plan = read('PLAN.md')
  const foundation = read('docs/foundation.md')
  const readme = read('README.md')
  const security = read('SECURITY.md')
  const decisions = read('docs/decisions.md')
  const architecture = read('docs/architecture.md')
  const backendProfile = read('docs/backend-paid-beta-profile.md')
  const repositoryStructure = read('docs/repo-structure.md')
  const currentState = read('docs/current-state.md')
  const governance = read('docs/governance.md')
  const policy = read('src/shared/commercialPolicy.ts')
  const projectContracts = read('src/shared/projectIpcContracts.ts')
  const projectIpc = read('src/main/projectIpc.ts')
  const projectMutationAuthorization = read('src/main/projectMutationAuthorization.ts')
  const projectCapabilities = read('src/main/projectCapabilities.ts')
  const vaultDataIpc = read('src/main/vaultDataIpc.ts')
  const mainIndex = read('src/main/index.ts')
  const auth = read('src/main/auth.ts')
  const communityRuntime = read('src/main/commercialRuntime.disabled.ts')
  const marketing = read('marketing-web/src/App.tsx')
  const setupScreen = read('src/renderer/src/components/SetupScreen.tsx')
  const accountSettings = read('src/renderer/src/components/CommercialAccountSettings.tsx')
  const commercialCapabilities = read('src/renderer/src/lib/CommercialFeatureCapabilities.ts')
  const communityCapabilities = read('src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts')
  const settingsModal = read('src/renderer/src/components/SettingsModal.tsx')
  const mainLayout = read('src/renderer/src/components/MainLayout.tsx')
  const paidBetaOnboarding = read('src/renderer/src/components/PaidBetaOnboarding.tsx')
  const secretDetail = read('src/renderer/src/components/SecretDetail.tsx')
  const addSecretModal = read('src/renderer/src/components/AddSecretModal.tsx')
  const secretAccessControls = read('src/renderer/src/components/SecretAccessControls.tsx')
  const secretRequestPanel = read('src/renderer/src/components/SecretRequestPanel.tsx')
  const sidebar = read('src/renderer/src/components/Sidebar.tsx')
  const menuPanelIpc = read('src/main/menuPanelIpc.ts')
  const stageOpenSource = read('scripts/stage-open-source.mjs')
  const canonicalTierSources = new Map([
    ['PLAN.md', plan],
    ['README.md', readme],
    ['SECURITY.md', security],
    ['docs/product.md', product],
    ['docs/foundation.md', foundation],
    ['docs/features.md', features],
    ['docs/architecture.md', architecture],
    ['docs/backend-paid-beta-profile.md', backendProfile],
    ['docs/repo-structure.md', repositoryStructure],
    ['docs/current-state.md', currentState],
    ['docs/governance.md', governance],
    ['docs/decisions.md', decisions],
    ['marketing-web/src/App.tsx', marketing],
  ])

  for (const [path, source] of [
    ['docs/product.md', product],
    ['docs/foundation.md', foundation],
    ['docs/features.md', features],
    ['marketing-web/src/App.tsx', marketing],
  ]) {
    requireCurrentTierSemantics(path, source)
  }
  for (const [path, source] of [
    ['docs/backend-paid-beta-profile.md', backendProfile],
    ['docs/current-state.md', currentState],
    ['docs/repo-structure.md', repositoryStructure],
    ['docs/governance.md', governance],
  ]) {
    requireMatch(
      path,
      source,
      /(?:sole|only)[\s\S]{0,120}(?:released\s+)?paid capability[\s\S]{0,140}(?:Services|pro\.services)/iu,
      'must retain Services as the only released paid capability',
    )
    requireMatch(
      path,
      source,
      /browser[- ]extension[\s\S]{0,160}(?:deferred|unavailable)|(?:deferred|unavailable)[\s\S]{0,160}browser[- ]extension/iu,
      'must retain the browser extension as deferred or unavailable',
    )
  }
  requireMatch(
    'docs/architecture.md',
    architecture,
    /browser-extension transport is deferred and\s+unavailable in released builds/iu,
    'must identify the extension transport as unavailable in released builds',
  )
  forbid(
    'docs/architecture.md',
    architecture,
    /requires the current `pro\.extension` capability|`pro\.extension`, an unlocked/u,
    'must not model the deferred extension as a current released capability',
  )
  for (const [path, source] of [
    ['PLAN.md', plan],
    ['README.md', readme],
    ['SECURITY.md', security],
    ['docs/decisions.md', withoutSupersededTierHistory('docs/decisions.md', decisions)],
  ]) {
    requireCurrentTierSemantics(path, source)
  }
  for (const path of CURRENT_CANONICAL_TIER_DOCS) {
    const source = canonicalTierSources.get(path)
    if (source === undefined) failures.push(`${path}: missing canonical source registration`)
    else forbidCurrentTierContradictions(path, withoutSupersededTierHistory(path, source))
  }
  for (const [path, source] of [
    ['src/renderer/src/components/SetupScreen.tsx', setupScreen],
    ['src/renderer/src/components/CommercialAccountSettings.tsx', accountSettings],
  ]) {
    forbid(
      path,
      source,
      /\b(?:two|2)\s+(?:user-selected\s+)?active\s+(?:local\s+)?Projects?\b|(?:at most|up to|limited to|falls? back to)\s+(?:two|2)\s+(?:active\s+)?(?:local\s+)?Projects?\b/iu,
      'customer-facing copy must not impose a numeric Free Project limit',
    )
    forbid(
      path,
      source,
      /Pro trial for Agent|Agent and Services|Agent(?:\s*\/\s*CLI)?[^\n]{0,120}(?:requires?\s+(?:an?\s+)?(?:active\s+)?(?:Trial|Pro)|paid (?:capability|entitlement))/iu,
      'customer-facing copy must not claim that Agent requires paid access',
    )
    forbid(
      path,
      source,
      /browser[- ]extension[^\n]{0,140}(?:separately release-gated|released paid capability|paid entitlement)|\bpro\.extension\b/iu,
      'customer-facing copy must not claim that the browser extension is released with paid access',
    )
  }

  requireMatch(
    'docs/product.md',
    product,
    /Closed Free[\s\S]{0,320}no\s+(?:commercial\s+)?active-project\s+limit/iu,
    'must state that Closed Free has no active-project limit',
  )

  const releasedBlock = policy.match(
    /DEFAULT_RELEASED_PRO_CAPABILITIES[^=]*= new Set\(\[([\s\S]*?)\]\)/u,
  )?.[1] ?? ''
  if (!releasedBlock) failures.push('src/shared/commercialPolicy.ts: released Pro capability set is missing')
  if (!releasedBlock.includes("'pro.services'") || /'pro\.(?:agent|extension)'/u.test(releasedBlock)) {
    failures.push('src/shared/commercialPolicy.ts: only pro.services may be released by default')
  }
  if (/cloud\.(?:oauth|sync|audit|spend)/u.test(releasedBlock)) {
    failures.push('src/shared/commercialPolicy.ts: a deferred cloud capability is released by default')
  }
  requireMatch(
    'src/shared/commercialPolicy.ts',
    policy,
    /activeProjectLimit:\s*null/u,
    'closed Free must expose an unlimited active-project limit',
  )
  requireMatch(
    'src/renderer/src/lib/CommercialFeatureCapabilities.ts',
    commercialCapabilities,
    /agent:\s*true/u,
    'closed Agent controls must be unconditional',
  )
  requireMatch(
    'src/renderer/src/lib/CommercialFeatureCapabilities.ts',
    commercialCapabilities,
    /services:\s*status\?\.capabilities\.includes\('pro\.services'\)\s*===\s*true/u,
    'Services controls must retain the pro.services boundary',
  )
  requireMatch(
    'src/renderer/src/lib/CommercialFeatureCapabilities.ts',
    commercialCapabilities,
    /extension:\s*false/u,
    'the deferred extension must remain unavailable',
  )
  for (const capability of ['agent', 'services', 'extension']) {
    requireMatch(
      'src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts',
      communityCapabilities,
      new RegExp(`${capability}:\\s*false`, 'u'),
      `Community must keep ${capability} controls disabled`,
    )
  }
  requireMatch(
    'src/renderer/src/components/SettingsModal.tsx',
    settingsModal,
    /agentSettingsToggleEnabled\(commercialCapabilities\.agent,\s*apiEnabled\)/u,
    'Settings must use the closed/Community Agent composition decision',
  )
  for (const [path, source] of [
    ['src/renderer/src/components/MainLayout.tsx', mainLayout],
    ['src/renderer/src/components/SettingsModal.tsx', settingsModal],
    ['src/renderer/src/components/AddSecretModal.tsx', addSecretModal],
    ['src/renderer/src/components/SecretDetail.tsx', secretDetail],
    ['src/renderer/src/components/SecretRequestPanel.tsx', secretRequestPanel],
    ['src/renderer/src/components/Sidebar.tsx', sidebar],
  ]) {
    requireMatch(
      path,
      source,
      /extensionReleaseControlVisible\(commercialCapabilities\.extension\)/u,
      'must gate extension entry points on the single released-extension capability',
    )
  }
  requireMatch(
    'src/renderer/src/components/SecretAccessControls.tsx',
    secretAccessControls,
    /extensionReleaseControlVisible\s*\?\s*\[EXTENSION_CONTROL,\s*\.\.\.CONTROLS\]\s*:\s*CONTROLS/u,
    'must omit the browser-extension access control until the extension releases',
  )
  requireMatch(
    'src/renderer/src/components/AddSecretModal.tsx',
    addSecretModal,
    /<SecretAccessControls[\s\S]{0,260}extensionReleaseControlVisible=\{extensionReleaseControlVisible\(commercialCapabilities\.extension\)\}/u,
    'must pass the released-extension decision to secret access controls',
  )
  requireMatch(
    'src/renderer/src/components/SecretDetail.tsx',
    secretDetail,
    /\{extensionReleaseControlVisible\s*&&\s*\([\s\S]{0,360}Browser extension & autofill/u,
    'must hide the browser access row until the extension releases',
  )
  requireMatch(
    'src/renderer/src/components/SecretRequestPanel.tsx',
    secretRequestPanel,
    /\{extensionUiReleased\s*&&\s*browserContext\s*&&/u,
    'must hide extension-origin request presentation until the extension releases',
  )
  requireMatch(
    'src/renderer/src/components/SettingsModal.tsx',
    settingsModal,
    /settingsTabs\.filter\(tab => tab\.id !== 'browser'\)/u,
    'must remove Browser settings while the extension is deferred',
  )
  requireMatch(
    'src/renderer/src/components/PaidBetaOnboarding.tsx',
    paidBetaOnboarding,
    /productStartDestinations\(commercialCapabilities\.services\)/u,
    'must expose Services in product onboarding only from the released entitlement decision',
  )
  forbid(
    'src/renderer/src/components/PaidBetaOnboarding.tsx',
    paidBetaOnboarding,
    /browser extension|paid beta|demo setup/iu,
    'must not present deferred extension or stale beta/demo framing in product onboarding',
  )
  forbid(
    'src/renderer/src/components/SecretDetail.tsx',
    secretDetail,
    /requires Pro (?:agent|extension) access/u,
    'must not present closed Free Agent access or deferred extension access as Pro requirements',
  )
  forbid(
    'src/renderer/src/components/SecretRequestPanel.tsx',
    secretRequestPanel,
    /Vaultage extension to save it|extension Save Token action/u,
    'must not guide Free Agent users through an unavailable extension flow',
  )
  requireMatch(
    'src/renderer/src/components/Sidebar.tsx',
    sidebar,
    /agentSidebarControlVisible\(commercialCapabilities\.agent,\s*apiEnabled\)/u,
    'Sidebar must use the closed/Community Agent composition decision',
  )
  forbid(
    'src/main/menuPanelIpc.ts',
    menuPanelIpc,
    /hasAgentCapability|Pro Agent access is required/u,
    'closed Agent menu controls must not depend on a paid capability',
  )
  requireMatch(
    'src/main/menuPanelIpc.ts',
    menuPanelIpc,
    /agentAvailable:\s*!deps\.openCoreBuild/u,
    'menu Agent controls must be available only in the closed composition',
  )
  requireMatch(
    'scripts/stage-open-source.mjs',
    stageOpenSource,
    /The Community sidebar exposes(?=[^.]*direct full-vault portable export)(?=[^.]*raw encrypted-file backup)[^.]*\./u,
    'generated Community docs must expose direct portable export and encrypted-file backup',
  )
  requireMatch(
    'scripts/stage-open-source.mjs',
    stageOpenSource,
    /Restore remains a compatibility API outside the Community shell\./u,
    'generated Community docs must keep restore outside the Community shell',
  )
  forbid(
    'scripts/stage-open-source.mjs',
    stageOpenSource,
    /backup\/restore[^\n]*Not exposed/u,
    'generated Community docs must not classify the exposed backup flow as unavailable',
  )
  requireMatch(
    'src/shared/projectIpcContracts.ts',
    projectContracts,
    /ProjectExportEnvPayload\s*=\s*\{[\s\S]{0,200}projectId:\s*string[\s\S]{0,100}environmentId:\s*string/u,
    'plaintext .env export must carry stored project and environment identities',
  )
  forbid(
    'src/shared/projectIpcContracts.ts',
    projectContracts.match(/ProjectExportEnvPayload\s*=\s*\{([\s\S]*?)\n\}/u)?.[1] ?? '',
    /\b(?:path|selections|addToGitignore)\??:/u,
    'renderer-controlled path, mappings, or gitignore behavior must not enter the export payload',
  )
  forbid(
    'src/shared/projectIpcContracts.ts',
    projectContracts.match(/ProjectExportEnvPayload\s*=\s*\{([\s\S]*?)\n\}/u)?.[1] ?? '',
    /plaintextConfirmation/u,
    'renderer-controlled confirmation text must not enter the Project export payload',
  )
  requireMatch(
    'src/main/projectIpc.ts',
    projectIpc,
    /resolveStoredProjectEnvExport\(currentVault, payload\.projectId, payload\.environmentId\)/u,
    'plaintext .env export must derive path and mappings from the stored project environment',
  )
  requireMatch(
    'src/main/projectIpc.ts',
    projectIpc,
    /acquireProjectExportLease\(currentVault, payload\.projectId\)/u,
    'plaintext .env export must acquire commercial project authorization',
  )
  requireMatch(
    'src/main/projectIpc.ts',
    projectIpc,
    /confirmProjectExportSummary\([\s\S]{0,1600}confirmProjectEnvExport\(/u,
    'plaintext .env export must show a main-owned exact summary before macOS user presence',
  )
  requireMatch(
    'src/main/auth.ts',
    auth,
    /confirmProjectEnvExport\([\s\S]{0,260}!this\.deps\.keychain\.isMac[\s\S]{0,220}confirmUnlockedKeychain/u,
    'Project .env export must fail closed without macOS user presence',
  )
  requireMatch(
    'src/main/projectIpc.ts',
    projectIpc,
    /authorizeCommit:\s*\(\)\s*=>\s*\{[\s\S]{0,180}commercialLease\.assertCurrent\(\)[\s\S]{0,180}getVaultRevision\(\)\s*===\s*authorizedVaultRevision/u,
    'plaintext .env export must revalidate commercial authorization and vault revision at filesystem commit',
  )
  requireMatch(
    'src/main/projectMutationAuthorization.ts',
    projectMutationAuthorization,
    /requireProjectFolder\(webContentsId, value, target\)/u,
    'newly persisted local Project paths must require a main-owned native-picker grant',
  )
  for (const pattern of [
    /ProjectFolderGrantPurpose\s*=\s*'project-local-path'\s*\|\s*'scan-parent'/u,
    /requireProjectFolder\([\s\S]{0,260}consume\s*=\s*false/u,
    /if \(consume\)[^\n]*delete\(key\)/u,
    /revokeAll\(\)/u,
  ]) {
    requireMatch(
      'src/main/projectCapabilities.ts',
      projectCapabilities,
      pattern,
      'Project folder grants must be purpose/target-bound, consumable, and globally revocable',
    )
  }
  requireMatch(
    'src/main/index.ts',
    mainIndex,
    /commercialRuntime\?\.suspend\([\s\S]{0,100}projectPathCapabilities\.revokeAll\(\)[\s\S]{0,180}vaultSession\.invalidate\(\)/u,
    'lock initiation must revoke Project grants and invalidate the key session before awaited flush work',
  )
  requireMatch(
    'src/main/commercialRuntime.disabled.ts',
    communityRuntime,
    /const acquireProjectExportLease[\s\S]{0,500}acquiredGeneration[\s\S]{0,500}generation !== acquiredGeneration/u,
    'Community Project export leases must invalidate across suspend/resume/dispose',
  )
  requireMatch(
    'src/main/vaultDataIpc.ts',
    vaultDataIpc,
    /authorizeProjectPathMutation\([\s\S]{0,180}webContentsId:\s*event\.sender\.id/u,
    'Project path mutation authorization must be bound to the invoking renderer',
  )

  for (const [path, source] of [
    ['PLAN.md', plan],
    ['docs/product.md', product],
    ['docs/foundation.md', foundation],
    ['docs/features.md', features],
  ]) {
    requireMatch(path, source, /30-day/iu, 'must preserve the exact 30-day trial duration')
    requireMatch(path, source, /no-card|no card/iu, 'must preserve the no-card trial promise')
    requireMatch(
      path,
      source,
      /no (?:automatic charge|auto-charge)|never (?:auto-charges|charges\s+automatically)|never converts into a charge automatically/iu,
      'must preserve the no-auto-charge trial promise',
    )
    requireMatch(
      path,
      source,
      /(?:managed OAuth[\s\S]{0,220}(?:deferred|future)|(?:deferred|future)[\s\S]{0,220}managed OAuth)/iu,
      'must label managed OAuth as deferred/future',
    )
    requireMatch(
      path,
      source,
      /(?:cloud (?:vault copy\/sync|sync)[\s\S]{0,240}(?:deferred|future)|(?:deferred|future)[\s\S]{0,240}cloud (?:vault copy\/sync|sync))/iu,
      'must label cloud vault copy/sync as deferred/future',
    )
    forbid(
      path,
      source,
      /(?:every|all) released Pro capabilit/iu,
      'must not call the unreleased paid-beta target set customer-released',
    )
  }

  forbid(
    'PLAN.md',
    plan,
    /No account required for Local or Agent|Continue without account \(Local\/Agent free forever\)/iu,
    'contains the superseded account-free Agent claim',
  )
  forbid(
    'marketing-web/src/App.tsx',
    marketing,
    /Advanced agent, provider, and sync workflows|>TBD<|Coming later/iu,
    'contains superseded paid-tier capability or pricing copy',
  )
  forbid(
    'marketing-web/src/App.tsx',
    marketing,
    /releases\/latest|Download Community|vault key never touches the disk|Touch ID & Secure Enclave|Local-first\. No Cloud\.|No accounts, no telemetry/iu,
    'contains a nonexistent release CTA or superseded security/cloud claim',
  )
  requireMatch(
    'marketing-web/src/App.tsx',
    marketing,
    /Official binaries are not released yet/iu,
    'must state that official Community binaries are not released',
  )
  for (const [value, description] of [
    ['$3.99', 'monthly Pro price'],
    ['$31.12', 'annual Pro price'],
    ['30-day', 'trial duration'],
    ['no card', 'no-card trial promise'],
  ]) {
    if (!marketing.toLowerCase().includes(value.toLowerCase())) {
      failures.push(`marketing-web/src/App.tsx: missing ${description}`)
    }
  }
} else {
  const readme = read('README.md')
  const repoStructure = read('docs/repo-structure.md')
  requireMatch(
    'README.md',
    readme,
    /does not require an account|accountless/iu,
    'Community source must state that it does not require an account',
  )
  requireMatch(
    'docs/features.md',
    features,
    /Agent request server[\s\S]{0,180}Private\/Pro/iu,
    'Community feature inventory must exclude the live Agent surface',
  )
  forbid(
    'docs/product.md',
    product,
    /Closed Free|commercial entitlement|Stripe Checkout/iu,
    'Community product brief must not present private commercial behavior as its own surface',
  )
  requireMatch(
    'README.md',
    readme,
    /pre-release source[\s\S]{0,180}not published an official Community binary/iu,
    'Community source must state that no official binary or customer-ready release exists',
  )
  requireMatch(
    'README.md',
    readme,
    /macOS user-presence unlock[\s\S]{0,160}system-password fallback/iu,
    'Community source must describe Keychain unlock as macOS user presence with possible fallback',
  )
  forbid(
    'README.md',
    readme,
    /exact typed confirmation on non-macOS builds|Touch ID unlock on macOS/iu,
    'Community source must not advertise an unsupported non-macOS product or Touch-ID-only unlock',
  )
  requireMatch(
    'docs/features.md',
    features,
    /Shipped[^\n]*staged Community source[\s\S]{0,180}does not[\s\S]{0,80}(?:official binary|customer readiness)/iu,
    'Community status vocabulary must distinguish staged source from a customer release',
  )
  requireMatch(
    'docs/repo-structure.md',
    repoStructure,
    /Deferred private ownership[\s\S]{0,260}managed[\s-]*OAuth[\s\S]{0,220}(?:sync|cloud audit)/iu,
    'Community boundary docs must label hosted/OAuth capabilities as deferred rather than current Pro',
  )
}

if (failures.length > 0) {
  console.error('Product-truth checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Product-truth checks passed (${privateTree ? 'private paid-beta' : 'Community'} tree).`)
