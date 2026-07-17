function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function projectDeletionConfirmation({
  projectName,
  environmentCount,
  mappingCount,
}: {
  projectName: string
  environmentCount: number
  mappingCount: number
}): string {
  return [
    `Delete project “${projectName}” from Vaultage?`,
    '',
    `This removes ${countLabel(environmentCount, 'environment')} and ${countLabel(mappingCount, 'secret mapping')} from the encrypted project configuration.`,
    'Saved secrets, remote service values, project source files, and existing .env files will not be deleted.',
  ].join('\n')
}

export function clearEnvironmentMappingsConfirmation(environmentName: string, mappingCount: number): string {
  return [
    `Clear ${countLabel(mappingCount, 'mapping')} from “${environmentName}”?`,
    '',
    'The target folder or provider remains connected, but no vault values will be mapped to environment keys.',
    'Saved secrets and existing local or remote environment values will not be deleted.',
  ].join('\n')
}

export function disconnectEnvironmentTargetConfirmation({
  environmentName,
  kind,
  targetLabel,
  mappingCount,
}: {
  environmentName: string
  kind: 'local' | 'cloud'
  targetLabel: string
  mappingCount: number
}): string {
  const targetType = kind === 'local' ? 'folder' : 'provider target'
  return [
    `Disconnect the ${targetType} from “${environmentName}”?`,
    '',
    targetLabel ? `Target: ${targetLabel}` : `No ${targetType} is currently selected.`,
    `${countLabel(mappingCount, 'mapping')} will remain in Vaultage, but sync is unavailable until another ${targetType} is connected.`,
    kind === 'local'
      ? 'The existing .env file and project folder will not be changed.'
      : 'Remote service values will not be changed.',
  ].join('\n')
}

export function resetLocalEnvironmentConfirmation({
  environmentName,
  localPath,
  mappingCount,
}: {
  environmentName: string
  localPath: string
  mappingCount: number
}): string {
  return [
    `Reset local environment “${environmentName}”?`,
    '',
    `Vaultage will disconnect ${localPath || 'the local folder'} and remove ${countLabel(mappingCount, 'mapping')} from this environment.`,
    'Saved secrets, the project folder, and any existing .env file will remain on disk.',
  ].join('\n')
}

export function deleteCloudEnvironmentConfirmation({
  environmentName,
  providerName,
  mappingCount,
}: {
  environmentName: string
  providerName?: string
  mappingCount: number
}): string {
  return [
    `Delete cloud environment “${environmentName}” from Vaultage?`,
    '',
    `This removes its ${countLabel(mappingCount, 'mapping')} and ${providerName ? `connection to ${providerName}` : 'provider target'} from the encrypted project configuration.`,
    'Saved secrets and remote service values will not be deleted.',
  ].join('\n')
}

export function replaceEnvFileConfirmation({
  localPath,
  valueCount,
  addToGitignore,
}: {
  localPath: string
  valueCount: number
  addToGitignore: boolean
}): string {
  return [
    `Replace the existing ${localPath}/.env file?`,
    '',
    `${countLabel(valueCount, 'selected value')} will be written in plaintext and the current file contents will be overwritten.`,
    addToGitignore
      ? 'Vaultage will also ensure .env is ignored by Git.'
      : 'Automatic .gitignore protection is off for this project.',
    'This overwrite cannot be undone by Vaultage.',
  ].join('\n')
}
