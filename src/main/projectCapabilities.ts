import { promises as fs } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'
import { MAX_PROJECT_MANUAL_FILES } from '../shared/projectScan'

export const PROJECT_CAPABILITY_TTL_MS = 10 * 60 * 1000
const MAX_CAPABILITIES_PER_RENDERER = 96

type CapabilityKind = 'folder' | 'file'
export type ProjectFolderGrantPurpose = 'project-local-path' | 'scan-parent'
export type ProjectFolderGrantTarget =
  | Readonly<{ kind: 'create' }>
  | Readonly<{ kind: 'project'; id: string }>

export const CREATE_PROJECT_GRANT_TARGET: ProjectFolderGrantTarget = Object.freeze({ kind: 'create' })

export function existingProjectGrantTarget(id: string): ProjectFolderGrantTarget {
  if (!id) throw new Error('Invalid environment project identity')
  return Object.freeze({ kind: 'project', id })
}

interface PathCapability {
  kind: CapabilityKind
  path: string
  expiresAt: number
  purpose?: ProjectFolderGrantPurpose
  target?: ProjectFolderGrantTarget
}

/**
 * Main-process authority for renderer-visible project paths. The renderer can
 * display a path, but it cannot use an arbitrary path unless the same
 * WebContents selected it through a native picker and the grant is still live.
 */
export class ProjectPathCapabilityStore {
  private readonly capabilities = new Map<number, Map<string, PathCapability>>()

  constructor(
    private readonly ttlMs = PROJECT_CAPABILITY_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async grantFolder(
    webContentsId: number,
    selectedPath: string,
    purpose: ProjectFolderGrantPurpose,
    target: ProjectFolderGrantTarget = CREATE_PROJECT_GRANT_TARGET,
  ): Promise<string> {
    const path = await canonicalRegularPath(selectedPath, 'folder')
    this.grant(webContentsId, { kind: 'folder', path, purpose, target, expiresAt: this.now() + this.ttlMs })
    return path
  }

  async grantFiles(webContentsId: number, selectedPaths: readonly string[]): Promise<string[]> {
    if (selectedPaths.length > MAX_PROJECT_MANUAL_FILES) {
      throw new Error(`Choose at most ${MAX_PROJECT_MANUAL_FILES} manual scan files`)
    }
    const paths: string[] = []
    for (const selectedPath of selectedPaths) {
      const path = await canonicalRegularPath(selectedPath, 'file')
      this.grant(webContentsId, { kind: 'file', path, expiresAt: this.now() + this.ttlMs })
      paths.push(path)
    }
    return paths
  }

  async requireProjectFolder(
    webContentsId: number,
    candidatePath: string,
    target: ProjectFolderGrantTarget,
    consume = false,
  ): Promise<string> {
    return this.require(webContentsId, candidatePath, 'folder', 'project-local-path', target, consume)
  }

  async requireScanParent(webContentsId: number, candidatePath: string): Promise<string> {
    return this.require(webContentsId, candidatePath, 'folder', 'scan-parent', CREATE_PROJECT_GRANT_TARGET, false)
  }

  async requireFilesWithin(
    webContentsId: number,
    rootPath: string,
    candidatePaths: readonly string[],
  ): Promise<string[]> {
    const paths: string[] = []
    for (const candidatePath of candidatePaths) {
      const path = await this.require(webContentsId, candidatePath, 'file')
      if (!isContainedPath(rootPath, path)) {
        throw new Error('Manual scan files must be contained in the selected project folder')
      }
      paths.push(path)
    }
    return paths
  }

  grantDiscoveredFolder(webContentsId: number, parentPath: string, candidatePath: string): void {
    const parent = resolve(parentPath)
    const candidate = resolve(candidatePath)
    if (candidate !== parent && !isContainedPath(parent, candidate)) {
      throw new Error('Discovered project escaped the selected parent folder')
    }
    this.grant(webContentsId, {
      kind: 'folder',
      path: candidate,
      purpose: 'project-local-path',
      target: CREATE_PROJECT_GRANT_TARGET,
      expiresAt: this.now() + this.ttlMs,
    })
  }

  revokeRenderer(webContentsId: number): void {
    this.capabilities.delete(webContentsId)
  }

  revokeAll(): void {
    this.capabilities.clear()
  }

  private async require(
    webContentsId: number,
    candidatePath: string,
    kind: CapabilityKind,
    purpose?: ProjectFolderGrantPurpose,
    target?: ProjectFolderGrantTarget,
    consume = false,
  ): Promise<string> {
    this.prune(webContentsId)
    const path = await canonicalRegularPath(candidatePath, kind)
    const key = capabilityKey(kind, path, purpose, target)
    const capability = this.capabilities.get(webContentsId)?.get(key)
    if (!capability || capability.expiresAt <= this.now()) {
      throw new Error(`${kind === 'folder' ? 'Project folder' : 'Manual file'} access expired; choose it again`)
    }
    if (consume) this.capabilities.get(webContentsId)?.delete(key)
    return path
  }

  private grant(webContentsId: number, capability: PathCapability): void {
    this.prune(webContentsId)
    let rendererCapabilities = this.capabilities.get(webContentsId)
    if (!rendererCapabilities) {
      rendererCapabilities = new Map()
      this.capabilities.set(webContentsId, rendererCapabilities)
    }
    rendererCapabilities.set(capabilityKey(
      capability.kind,
      capability.path,
      capability.purpose,
      capability.target,
    ), capability)
    while (rendererCapabilities.size > MAX_CAPABILITIES_PER_RENDERER) {
      const oldest = rendererCapabilities.keys().next().value
      if (typeof oldest !== 'string') break
      rendererCapabilities.delete(oldest)
    }
  }

  private prune(webContentsId: number): void {
    const rendererCapabilities = this.capabilities.get(webContentsId)
    if (!rendererCapabilities) return
    const now = this.now()
    for (const [key, capability] of rendererCapabilities) {
      if (capability.expiresAt <= now) rendererCapabilities.delete(key)
    }
    if (rendererCapabilities.size === 0) this.capabilities.delete(webContentsId)
  }
}

async function canonicalRegularPath(input: string, kind: CapabilityKind): Promise<string> {
  if (typeof input !== 'string' || input.includes('\0') || !isAbsolute(input)) {
    throw new Error(`Invalid ${kind === 'folder' ? 'project folder' : 'manual file'}`)
  }
  const normalized = resolve(input)
  const stat = await fs.lstat(normalized).catch(() => null)
  const valid = kind === 'folder' ? stat?.isDirectory() : stat?.isFile()
  if (!valid || stat?.isSymbolicLink()) {
    throw new Error(`${kind === 'folder' ? 'Project folder' : 'Manual file'} is not a regular ${kind}`)
  }
  const canonical = await fs.realpath(normalized)
  return canonical
}

function capabilityKey(
  kind: CapabilityKind,
  path: string,
  purpose?: ProjectFolderGrantPurpose,
  target?: ProjectFolderGrantTarget,
): string {
  return JSON.stringify([
    kind,
    purpose ?? null,
    target?.kind ?? null,
    target?.kind === 'project' ? target.id : null,
    path,
  ])
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
  const rel = relative(parentPath, candidatePath)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
