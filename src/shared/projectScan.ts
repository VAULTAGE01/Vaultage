export type ProjectScanConfidence = 'high' | 'medium' | 'low'

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
}
