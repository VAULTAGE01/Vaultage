export type ProjectScanConfidence = 'high' | 'medium' | 'low'

export const MAX_PROJECT_MANUAL_FILES = 32

export interface ProjectScanFileRef {
  path: string
  line?: number
  kind: 'env-file' | 'code-reference' | 'manifest' | 'config' | 'manual'
  excerpt?: string
  manual?: boolean
}

export interface ProjectScanProjectType {
  label: string
  confidence: ProjectScanConfidence
  evidence: string[]
}

export interface ProjectScanService {
  id: string
  label: string
  confidence: ProjectScanConfidence
  evidence: string[]
}

export interface ProjectScanEnvValue {
  value: string
  sourceFile: string
  line: number
  environment?: string
  manual?: boolean
}

export interface ProjectScanEnvKey {
  key: string
  serviceId?: string
  serviceLabel?: string
  environment?: string
  sources: ProjectScanFileRef[]
  values: ProjectScanEnvValue[]
}

export interface ProjectScanEnvFile {
  path: string
  environment?: string
  keyCount: number
  manual?: boolean
}

export interface ProjectScanResult {
  rootPath: string
  scannedAt: string
  scannedFileCount: number
  skippedFileCount: number
  manualFiles: string[]
  projectTypes: ProjectScanProjectType[]
  services: ProjectScanService[]
  envFiles: ProjectScanEnvFile[]
  envKeys: ProjectScanEnvKey[]
  warnings: string[]
}

export interface ProjectScanRequest {
  path: string
  manualFiles?: string[]
  /** Existing project identity; omitted only while evaluating a new project. */
  projectId?: string
  /** Closed-Free active slot selected for an atomic new-project replacement. */
  replaceProjectId?: string
}

export interface ProjectDiscoverRequest {
  parentPath: string
  /** Closed-Free active slot selected for candidate authorization. */
  replaceProjectId?: string
}

export interface ProjectScanCandidate {
  path: string
  name: string
  envKeyCount: number
  envFileCount: number
  serviceCount: number
  services: string[]
  projectTypes: string[]
  scannedFileCount: number
  warningCount: number
}

export interface ProjectDiscoverResult {
  parentPath: string
  scannedAt: string
  candidates: ProjectScanCandidate[]
  warnings: string[]
}
