import {
  MAX_PROJECT_MANUAL_FILES,
  type ProjectDiscoverRequest,
  type ProjectDiscoverResult,
  type ProjectScanRequest,
  type ProjectScanResult,
} from './projectScan'
import {
  contract,
  optionalString,
  optionalStringArray,
  optionalBoolean,
  requireRecord,
  requireString,
  validateNoPayload,
  type BaseIpcResult,
  type NoPayload,
} from './ipcContracts'

export type EnvSelectionPayload = {
  envKey: string
  secretId: string
  fieldId?: string
  fieldKey: string
}

export const MAX_IPC_ENV_SELECTIONS = 64

export type ProjectExportEnvPayload = {
  projectId: string
  environmentId: string
  overwriteExisting?: boolean
}

export type ProjectPickFolderPayload = {
  purpose: 'project-local-path' | 'scan-parent'
  projectId?: string
}

export type ProjectScanIpcResult = BaseIpcResult & { result?: ProjectScanResult }
export type ProjectDiscoverIpcResult = BaseIpcResult & { result?: ProjectDiscoverResult }
export type ProjectExportEnvResult = BaseIpcResult & {
  status?: ProjectEnvWriteStatus
  partial?: ProjectEnvWriteStatus
  requiresOverwriteConfirmation?: boolean
}

export type ProjectEnvWriteStatus = {
  envFile: 'created' | 'replaced' | 'not-written'
  gitignore: 'created' | 'updated' | 'unchanged' | 'not-requested' | 'not-updated'
}

export interface ProjectIpcApi {
  pickFolder(payload: ProjectPickFolderPayload): Promise<string | null>
  pickProjectFiles(): Promise<string[]>
  scanProject(payload: ProjectScanRequest): Promise<ProjectScanIpcResult>
  discoverProjects(payload: ProjectDiscoverRequest): Promise<ProjectDiscoverIpcResult>
  exportEnv(payload: ProjectExportEnvPayload): Promise<ProjectExportEnvResult>
}

export const projectIpcContracts = {
  pickFolder: contract<ProjectPickFolderPayload, string | null>('project:pick-folder', validateProjectPickFolderPayload),
  pickProjectFiles: contract<NoPayload, string[]>('project:pick-files', validateNoPayload),
  scan: contract<ProjectScanRequest, ProjectScanIpcResult>('project:scan', validateProjectScanPayload),
  discover: contract<ProjectDiscoverRequest, ProjectDiscoverIpcResult>('project:discover', validateProjectDiscoverPayload),
  exportEnv: contract<ProjectExportEnvPayload, ProjectExportEnvResult>('project:export-env', validateProjectExportEnvPayload),
} as const

function validateProjectPickFolderPayload(payload: unknown): ProjectPickFolderPayload {
  const record = requireRecord(payload, 'project folder picker payload')
  const allowedKeys = new Set(['purpose', 'projectId'])
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new Error(`Unexpected project folder picker field: ${key}`)
  }
  const purpose = requireString(record.purpose, 'project folder picker purpose')
  if (purpose !== 'project-local-path' && purpose !== 'scan-parent') {
    throw new Error('Invalid project folder picker purpose')
  }
  const projectId = optionalString(record.projectId, 'project id')
  if (purpose === 'scan-parent' && projectId !== undefined) {
    throw new Error('Scan-parent picker cannot target a Project')
  }
  return {
    purpose,
    projectId: projectId === undefined ? undefined : validateIdentifier(projectId, 'project id'),
  }
}

function validateProjectScanPayload(payload: unknown): ProjectScanRequest {
  const record = requireRecord(payload, 'project scan payload')
  const manualFiles = optionalStringArray(record.manualFiles, 'manual files')
  if (manualFiles && manualFiles.length > MAX_PROJECT_MANUAL_FILES) {
    throw new Error(`Choose at most ${MAX_PROJECT_MANUAL_FILES} manual scan files`)
  }
  return {
    path: validatePathString(requireString(record.path, 'project path'), 'project path'),
    manualFiles: manualFiles?.map(path => validatePathString(path, 'manual file')),
    projectId: record.projectId === undefined
      ? undefined
      : validateIdentifier(requireString(record.projectId, 'project id'), 'project id'),
    replaceProjectId: record.replaceProjectId === undefined
      ? undefined
      : validateIdentifier(requireString(record.replaceProjectId, 'replacement project id'), 'replacement project id'),
  }
}

function validateProjectDiscoverPayload(payload: unknown): ProjectDiscoverRequest {
  const record = requireRecord(payload, 'project discovery payload')
  const allowedKeys = new Set(['parentPath', 'replaceProjectId'])
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new Error(`Unexpected project discovery field: ${key}`)
  }
  return {
    parentPath: validatePathString(requireString(record.parentPath, 'parent path'), 'parent path'),
    replaceProjectId: record.replaceProjectId === undefined
      ? undefined
      : validateIdentifier(requireString(record.replaceProjectId, 'replacement project id'), 'replacement project id'),
  }
}

function validateProjectExportEnvPayload(payload: unknown): ProjectExportEnvPayload {
  const record = requireRecord(payload, 'project export payload')
  const allowedKeys = new Set(['projectId', 'environmentId', 'overwriteExisting'])
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new Error(`Unexpected project export field: ${key}`)
  }
  return {
    projectId: validateIdentifier(requireString(record.projectId, 'project id'), 'project id'),
    environmentId: validateIdentifier(requireString(record.environmentId, 'environment id'), 'environment id'),
    overwriteExisting: optionalBoolean(record.overwriteExisting, 'overwriteExisting') ?? false,
  }
}

function validatePathString(path: string, label: string): string {
  if (!path || path.length > 4096 || path.includes('\0')) throw new Error(`Invalid ${label}`)
  return path
}

function validateIdentifier(value: string, label: string): string {
  if (!value || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}
