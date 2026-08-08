export const COMMUNITY_UI_E2E_HAPPY_SCENARIOS = [
  'setup',
  'multi-vault',
  'sidebar-drag-drop',
  'secret-context',
  'vault-controls',
  'persistence',
  'project-mapping',
] as const

export const COMMUNITY_UI_E2E_ADVERSARIAL_SCENARIOS = [
  'cancel',
  'substitution',
  'replay',
  'scan-failure',
  'cleanup',
] as const

export const COMMUNITY_UI_E2E_POLICY_SCENARIOS = ['offline', 'lifecycle'] as const

type HappyScenario = (typeof COMMUNITY_UI_E2E_HAPPY_SCENARIOS)[number]
type AdversarialScenario = (typeof COMMUNITY_UI_E2E_ADVERSARIAL_SCENARIOS)[number]
type PolicyScenario = (typeof COMMUNITY_UI_E2E_POLICY_SCENARIOS)[number]
type ScenarioName = HappyScenario | AdversarialScenario | PolicyScenario

export type CommunityUIE2EScenarioSelection = {
  readonly adversarial: readonly AdversarialScenario[]
  readonly happy: readonly HappyScenario[]
  readonly policy: readonly PolicyScenario[]
}

const ALL_SCENARIOS = [
  ...COMMUNITY_UI_E2E_HAPPY_SCENARIOS,
  ...COMMUNITY_UI_E2E_ADVERSARIAL_SCENARIOS,
  ...COMMUNITY_UI_E2E_POLICY_SCENARIOS,
] as const

function isScenarioName(candidate: string): candidate is ScenarioName {
  return ALL_SCENARIOS.some(name => name === candidate)
}

export function selectCommunityUIE2EScenarios(
  raw: string | undefined,
): CommunityUIE2EScenarioSelection {
  const requested = raw === undefined ? [...ALL_SCENARIOS] : raw.split(',')
  if (requested.length === 0 || requested.some(name => !isScenarioName(name))) {
    throw new Error('Community E2E scenario selection is invalid')
  }
  const selected = new Set(requested)
  if (selected.size !== requested.length) {
    throw new Error('Community E2E scenario selection contains duplicates')
  }
  return {
    adversarial: COMMUNITY_UI_E2E_ADVERSARIAL_SCENARIOS.filter(name => selected.has(name)),
    happy: COMMUNITY_UI_E2E_HAPPY_SCENARIOS.filter(name => selected.has(name)),
    policy: COMMUNITY_UI_E2E_POLICY_SCENARIOS.filter(name => selected.has(name)),
  }
}
