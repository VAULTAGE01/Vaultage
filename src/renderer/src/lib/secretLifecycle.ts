import type {
  EnvProject,
  Provider,
  ProviderLinkStatus,
  ProviderType,
  VaultRoot,
  VaultSecret,
} from '../types'
import { PROVIDER_LABELS } from '../types'
import { allowsAgentRelease } from '../../../shared/secretAccessPolicy'

export type SecretLifecycleStatus = ProviderLinkStatus | 'local-only'

export interface SecretProjectUsage {
  projectId: string
  projectName: string
  projectPath: string
  envKey: string
  fieldKey: string
  addToGitignore: boolean
  lastExportAt?: string
}

export interface SecretServiceLink {
  serviceId: string
  serviceName: string
  serviceType: ProviderType | string
  serviceTypeLabel: string
  remoteName: string
  remoteId?: string
  scopes: string[]
  createdHere: boolean
  status: ProviderLinkStatus
  statusLabel: string
  statusUpdatedAt?: string
  lastVerifiedAt?: string
  serviceMissing: boolean
}

export interface SecretLifecycleNextStep {
  id: 'classify' | 'map-project' | 'agent-access' | 'review-service'
  title: string
  detail: string
}

export interface SecretLifecycle {
  status: SecretLifecycleStatus
  statusLabel: string
  statusTone: 'neutral' | 'success' | 'warning' | 'danger'
  service: SecretServiceLink | null
  projectUsages: SecretProjectUsage[]
  usageNotes: string[]
  agentReady: boolean
  agentAccessLabel: string
  hasRelationships: boolean
  nextSteps: SecretLifecycleNextStep[]
}

export function getProviderLinkStatusLabel(status: SecretLifecycleStatus): string {
  switch (status) {
    case 'active': return 'Active'
    case 'revoked': return 'Revoked'
    case 'missing': return 'Missing remotely'
    case 'local-only': return 'Local-only'
  }
}

function getProviderLinkStatusTone(status: SecretLifecycleStatus): SecretLifecycle['statusTone'] {
  switch (status) {
    case 'active': return 'success'
    case 'revoked': return 'danger'
    case 'missing': return 'warning'
    case 'local-only': return 'neutral'
  }
}

function getSecretProjectUsages(projects: EnvProject[], secretId: string): SecretProjectUsage[] {
  return projects.flatMap(project =>
    project.entries
      .filter(entry => entry.secretId === secretId)
      .map(entry => ({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        envKey: entry.envKey,
        fieldKey: entry.fieldKey,
        addToGitignore: project.addToGitignore,
        lastExportAt: project.lastExportAt,
      })),
  )
}

export function getSecretLifecycle(vault: VaultRoot, secret: VaultSecret): SecretLifecycle {
  const service = getServiceLink(vault.providers ?? [], secret)
  const status: SecretLifecycleStatus = service?.status ?? 'local-only'
  const projectUsages = getSecretProjectUsages(vault.envProjects ?? [], secret.id)
  const usageNotes = secret.usedIn ?? []
  const agentReady = allowsAgentRelease(secret)
  const nextSteps: SecretLifecycleNextStep[] = []

  if (!secret.description && !secret.scope && !(secret.tags?.length)) {
    nextSteps.push({
      id: 'classify',
      title: 'Classify in Vault',
      detail: 'Add owner, scope, tags, or expiry when this value needs governance.',
    })
  }
  if (projectUsages.length === 0) {
    nextSteps.push({
      id: 'map-project',
      title: 'Map to a Local project',
      detail: 'Optional: attach this value to an env key so Local can consume it safely.',
    })
  }
  if (!agentReady) {
    nextSteps.push({
      id: 'agent-access',
      title: 'Decide agent access',
      detail: 'Keep approval required or mark it available for agent requests.',
    })
  }
  if (status === 'revoked' || status === 'missing') {
    nextSteps.push({
      id: 'review-service',
      title: 'Review service link',
      detail: 'The Vault record remains, but the linked remote credential needs attention.',
    })
  }

  return {
    status,
    statusLabel: getProviderLinkStatusLabel(status),
    statusTone: getProviderLinkStatusTone(status),
    service,
    projectUsages,
    usageNotes,
    agentReady,
    agentAccessLabel: agentReady ? 'Available to agents' : 'Approval required',
    hasRelationships: Boolean(service) || projectUsages.length > 0,
    nextSteps,
  }
}

function getServiceLink(providers: Provider[], secret: VaultSecret): SecretServiceLink | null {
  const link = secret.providerLink
  if (!link) return null
  const provider = providers.find(item => item.id === link.providerId)
  const serviceMissing = !provider
  const status = serviceMissing ? 'missing' : link.status ?? 'active'
  const serviceType = provider?.type ?? 'unknown'

  return {
    serviceId: link.providerId,
    serviceName: provider?.name ?? 'Disconnected service',
    serviceType,
    serviceTypeLabel: provider
      ? PROVIDER_LABELS[provider.type] ?? provider.type
      : 'Unknown service',
    remoteName: link.remoteName,
    remoteId: link.remoteId,
    scopes: link.scopes ?? [],
    createdHere: link.createdInVaultage,
    status,
    statusLabel: getProviderLinkStatusLabel(status),
    statusUpdatedAt: link.statusUpdatedAt,
    lastVerifiedAt: link.lastVerifiedAt,
    serviceMissing,
  }
}
