import { contract, requireNonEmptyString, requireRecord, type BaseIpcResult } from './ipcContracts'

export type CloudflareAgentTokenPolicyTargetPayload = {
  readonly providerId: string
  readonly projectId: string
  readonly environment: 'development' | 'staging'
}

export type CloudflareAgentTokenPolicySavePayload = CloudflareAgentTokenPolicyTargetPayload & {
  readonly name: string
  readonly expiresOn?: string
  readonly currentPolicyId?: string
  readonly permissionGroupIds: readonly string[]
}

export type CloudflareAgentTokenPermissionGroupMetadata = {
  readonly id: string
  readonly name: string
  readonly scopes: readonly string[]
}

export type CloudflareAgentTokenPolicyMetadata = {
  readonly id: string
  readonly revision: number
  readonly providerId: string
  readonly projectId: string
  readonly environment: 'development' | 'staging'
  readonly name: string
  readonly expiresOn?: string
  readonly permissionGroups: readonly CloudflareAgentTokenPermissionGroupMetadata[]
}

export type CloudflareAgentTokenPolicyLoadResult = BaseIpcResult & {
  readonly permissionGroups?: readonly CloudflareAgentTokenPermissionGroupMetadata[]
  readonly currentPolicy?: CloudflareAgentTokenPolicyMetadata
}

export type CloudflareAgentTokenPolicySaveResult = BaseIpcResult & {
  readonly policy?: CloudflareAgentTokenPolicyMetadata
  readonly revision?: number
}

export const cloudflareAgentTokenPolicyIpcContracts = {
  cloudflareAgentTokenPolicyLoad: contract<CloudflareAgentTokenPolicyTargetPayload, CloudflareAgentTokenPolicyLoadResult>(
    'provider:cloudflare-agent-token-policy-load', validateTarget,
  ),
  cloudflareAgentTokenPolicySave: contract<CloudflareAgentTokenPolicySavePayload, CloudflareAgentTokenPolicySaveResult>(
    'provider:cloudflare-agent-token-policy-save', validateSave,
  ),
}

function validateTarget(payload: unknown): CloudflareAgentTokenPolicyTargetPayload {
  const record = exactRecord(payload, ['providerId', 'projectId', 'environment'], 'Cloudflare agent token policy target')
  const environment = record.environment
  if (environment !== 'development' && environment !== 'staging') throw new Error('Invalid Cloudflare policy environment')
  return { providerId: requirePolicyId(record.providerId, 'provider id'), projectId: requirePolicyId(record.projectId, 'project id'), environment }
}

function validateSave(payload: unknown): CloudflareAgentTokenPolicySavePayload {
  const record = exactRecord(payload, ['providerId', 'projectId', 'environment', 'name', 'permissionGroupIds'], 'Cloudflare agent token policy save', ['expiresOn', 'currentPolicyId'])
  const target = validateTarget({ providerId: record.providerId, projectId: record.projectId, environment: record.environment })
  const ids = exactStringArray(record.permissionGroupIds, 'permissionGroupIds', 128).map(id => requirePolicyId(id, 'permission group id').toLowerCase())
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error('Invalid Cloudflare policy permission groups')
  return { ...target, name: boundedText(record.name, 'policy name', 120), permissionGroupIds: ids,
    ...(record.expiresOn === undefined ? {} : { expiresOn: boundedText(record.expiresOn, 'policy expiration', 40) }),
    ...(record.currentPolicyId === undefined ? {} : { currentPolicyId: requirePolicyId(record.currentPolicyId, 'current policy id') }), }
}

function exactRecord(value: unknown, required: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> {
  const record = requireRecord(value, label)
  const prototype = Object.getPrototypeOf(record)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Invalid ${label}`)
  const allowed = new Set([...required, ...optional])
  const keys = Reflect.ownKeys(record)
  if (keys.length < required.length || keys.some(key => typeof key !== 'string' || !allowed.has(key))) throw new Error(`Invalid ${label}`)
  if (keys.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    return !descriptor || !descriptor.enumerable || !('value' in descriptor)
  })) throw new Error(`Invalid ${label}`)
  if (required.some(key => !Object.hasOwn(record, key))) throw new Error(`Invalid ${label}`)
  return record
}

function exactStringArray(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw new Error(`Invalid ${label}`)
  const result: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error(`Invalid ${label}`)
    result.push(requireNonEmptyString(descriptor.value, label))
  }
  return result
}

function requirePolicyId(value: unknown, label: string): string {
  return boundedText(value, label, 240)
}

function boundedText(value: unknown, label: string, max: number): string {
  const text = requireNonEmptyString(value, label)
  if (text.length > max) throw new Error(`Invalid ${label}`)
  return text
}
