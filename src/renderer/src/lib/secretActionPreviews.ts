import type { EnvProject, VaultSecret } from '../types'
import { getProjectEnvironments } from './projectEnvironments'

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function countSecretProjectMappings(
  projects: EnvProject[],
  secretId: string,
  fieldKey?: string,
): number {
  return projects.reduce((count, project) => (
    count + getProjectEnvironments(project).reduce((environmentCount, environment) => (
      environmentCount + environment.entries.filter(entry => (
        entry.secretId === secretId && (!fieldKey || entry.fieldKey === fieldKey)
      )).length
    ), 0)
  ), 0)
}

export function secretDeletionConfirmation({
  secret,
  projectMappingCount,
}: {
  secret: Pick<VaultSecret, 'name' | 'providerLink'>
  projectMappingCount: number
}): string {
  const consequences = [
    'Its encrypted fields, notes, and metadata will be permanently removed from this vault.',
    projectMappingCount > 0
      ? `${countLabel(projectMappingCount, 'project mapping')} will be removed automatically.`
      : 'No project mappings reference this secret.',
    'Existing exported files, including plaintext .env files, will remain unchanged.',
  ]
  if (secret.providerLink) {
    consequences.push('The linked remote service value will not be revoked or deleted.')
  }

  return [
    `Delete “${secret.name}” from Vaultage?`,
    '',
    ...consequences,
    '',
    'This vault deletion cannot be undone.',
  ].join('\n')
}

export function secretEnvironmentRemovalConfirmation({
  secretName,
  environmentLabel,
  projectMappingCount,
}: {
  secretName: string
  environmentLabel: string
  projectMappingCount: number
}): string {
  return [
    `Remove the ${environmentLabel} value from “${secretName}”?`,
    '',
    'The encrypted field and its value will be permanently removed from this vault record.',
    projectMappingCount > 0
      ? `${countLabel(projectMappingCount, 'project mapping')} will remain but will need a replacement field before it can sync.`
      : 'No project mappings reference this field.',
    'Other environment values, existing exported files, and remote service data will remain unchanged.',
  ].join('\n')
}
