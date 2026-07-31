export interface SecretAccessPolicy {
  browserExtension: boolean
  agent: boolean
  revealCopy: boolean
  cliExport: boolean
}

export interface SecretAccessPolicyRecord {
  browserExtensionAllowed?: boolean
  agentAvailable?: boolean
  revealAllowed?: boolean
  cliExportAllowed?: boolean
}

const DEFAULT_POLICY: Readonly<SecretAccessPolicy> = Object.freeze({
  browserExtension: true,
  agent: true,
  revealCopy: true,
  cliExport: true,
})

export function createDefaultSecretAccessPolicy(): SecretAccessPolicy {
  return { ...DEFAULT_POLICY }
}

export function readSecretAccessPolicy(record: SecretAccessPolicyRecord): SecretAccessPolicy {
  return {
    browserExtension: record.browserExtensionAllowed ?? record.agentAvailable === true,
    agent: record.agentAvailable === true,
    revealCopy: record.revealAllowed !== false,
    cliExport: record.cliExportAllowed !== false,
  }
}

export function writeSecretAccessPolicy<T extends SecretAccessPolicyRecord>(
  record: T,
  policy: SecretAccessPolicy,
): T & Required<SecretAccessPolicyRecord> {
  return {
    ...record,
    browserExtensionAllowed: policy.browserExtension,
    agentAvailable: policy.agent,
    revealAllowed: policy.revealCopy,
    cliExportAllowed: policy.cliExport,
  }
}

export function allowsAgentRelease(record: SecretAccessPolicyRecord): boolean {
  return readSecretAccessPolicy(record).agent
}

export function allowsBrowserExtensionRelease(record: SecretAccessPolicyRecord): boolean {
  return readSecretAccessPolicy(record).browserExtension
}

export function allowsRevealOrCopy(record: SecretAccessPolicyRecord): boolean {
  return readSecretAccessPolicy(record).revealCopy
}

export function allowsCliExport(record: SecretAccessPolicyRecord): boolean {
  return readSecretAccessPolicy(record).cliExport
}
