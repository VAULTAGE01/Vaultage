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
  const agentView = read('src/renderer/src/components/AgentView.tsx')
  const stageOpenSource = read('scripts/stage-open-source.mjs')

  requireMatch(
    'docs/product.md',
    product,
    /Closed Free[\s\S]{0,320}(?:two|2) active/iu,
    'must state the closed-Free two-active-Project limit',
  )

  const releasedBlock = policy.match(
    /DEFAULT_RELEASED_PRO_CAPABILITIES[^=]*= new Set\(\[([\s\S]*?)\]\)/u,
  )?.[1] ?? ''
  if (!releasedBlock) failures.push('src/shared/commercialPolicy.ts: released Pro capability set is missing')
  for (const capability of ['pro.agent', 'pro.services', 'pro.extension']) {
    if (!releasedBlock.includes(`'${capability}'`)) {
      failures.push(`src/shared/commercialPolicy.ts: released Pro capability ${capability} is missing`)
    }
  }
  if (/cloud\.(?:oauth|sync|audit|spend)/u.test(releasedBlock)) {
    failures.push('src/shared/commercialPolicy.ts: a deferred cloud capability is released by default')
  }
  requireMatch(
    'src/shared/commercialPolicy.ts',
    policy,
    /DEFAULT_FREE_ACTIVE_PROJECT_LIMIT\s*=\s*2\b/u,
    'closed Free must default to exactly two active Projects',
  )
  requireMatch(
    'src/shared/commercialPolicy.ts',
    policy,
    /MAX_FREE_ACTIVE_PROJECT_LIMIT\s*=\s*DEFAULT_FREE_ACTIVE_PROJECT_LIMIT\b/u,
    'closed Free must reject Control policy above the advertised two-Project ceiling',
  )
  requireMatch(
    'src/renderer/src/components/AgentView.tsx',
    agentView,
    /agentRequestsEnabled\s*=\s*AGENT_REQUESTS_COMPILED\s*&&\s*commercialCapabilities\.agent/u,
    'closed Agent request UI must require the paid Agent capability, not only compile-time inclusion',
  )
  requireMatch(
    'src/renderer/src/components/AgentView.tsx',
    agentView,
    /agentRequestsEnabled\s*\?\s*'Agent Access'\s*:\s*'Environments'/u,
    'closed Free Environment Settings must replace the Agent metric with neutral Project data',
  )
  requireMatch(
    'src/renderer/src/components/AgentView.tsx',
    agentView,
    /agentRequestsEnabled[\s\S]{0,140}'Open project history, syncs, mappings, and agent events\.'[\s\S]{0,100}'Open project history, syncs, and mappings\.'/u,
    'closed Free Project audit copy must not advertise Agent events',
  )
  requireMatch(
    'scripts/stage-open-source.mjs',
    stageOpenSource,
    /Encrypted file backup[\s\S]{0,180}portable full-vault export are exposed directly through Export/u,
    'generated Community docs must classify backup as exposed while leaving restore outside the shell',
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
    ['$5.99', 'monthly Pro price'],
    ['$47.88', 'annual Pro price'],
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
