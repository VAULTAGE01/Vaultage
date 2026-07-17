import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CREATE_PROJECT_GRANT_TARGET,
  existingProjectGrantTarget,
  ProjectPathCapabilityStore,
} from './projectCapabilities'

let roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

describe('project path capabilities', () => {
  it('binds native-picker grants to one WebContents and expires them', async () => {
    const root = await tempRoot()
    let now = 1_000
    const store = new ProjectPathCapabilityStore(100, () => now)
    const target = existingProjectGrantTarget('project-1')
    const granted = await store.grantFolder(7, root, 'project-local-path', target)

    await expect(store.requireProjectFolder(7, granted, target)).resolves.toBe(granted)
    await expect(store.requireProjectFolder(8, granted, target)).rejects.toThrow('access expired; choose it again')

    now += 101
    await expect(store.requireProjectFolder(7, granted, target)).rejects.toThrow('access expired; choose it again')
  })

  it('requires separately granted manual files to remain inside the selected project', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const insideFile = join(root, 'inside.env')
    const outsideFile = join(outside, 'outside.env')
    await writeFile(insideFile, 'INSIDE=value\n')
    await writeFile(outsideFile, 'OUTSIDE=value\n')
    const store = new ProjectPathCapabilityStore()
    const grantedRoot = await store.grantFolder(3, root, 'project-local-path')
    const [grantedInside, grantedOutside] = await store.grantFiles(3, [insideFile, outsideFile])

    await expect(store.requireFilesWithin(3, grantedRoot, [grantedInside])).resolves.toEqual([grantedInside])
    await expect(store.requireFilesWithin(3, grantedRoot, [grantedOutside])).rejects.toThrow('contained')
  })

  it('rejects directly selected symbolic links', async () => {
    const root = await tempRoot()
    const target = join(root, 'target.env')
    const link = join(root, 'link.env')
    await writeFile(target, 'TOKEN=value\n')
    await symlink(target, link)
    const store = new ProjectPathCapabilityStore()

    await expect(store.grantFiles(1, [link])).rejects.toThrow('not a regular file')
  })

  it('authorizes discovered child projects without granting arbitrary sibling paths', async () => {
    const root = await tempRoot()
    const child = join(root, 'child')
    const outside = await tempRoot()
    await mkdir(child)
    const store = new ProjectPathCapabilityStore()
    const grantedRoot = await store.grantFolder(4, root, 'scan-parent')
    const canonicalChild = await realpath(child)

    await expect(store.requireProjectFolder(4, canonicalChild, CREATE_PROJECT_GRANT_TARGET)).rejects.toThrow('choose it again')
    store.grantDiscoveredFolder(4, grantedRoot, canonicalChild)
    await expect(store.requireProjectFolder(4, canonicalChild, CREATE_PROJECT_GRANT_TARGET)).resolves.toBe(canonicalChild)
    expect(() => store.grantDiscoveredFolder(4, grantedRoot, outside)).toThrow('escaped')
  })

  it('prevents cross-purpose and cross-project reuse and consumes mutation grants once', async () => {
    const root = await tempRoot()
    const store = new ProjectPathCapabilityStore()
    const target = existingProjectGrantTarget('project-1')
    const granted = await store.grantFolder(7, root, 'project-local-path', target)

    await expect(store.requireScanParent(7, granted)).rejects.toThrow('choose it again')
    await expect(store.requireProjectFolder(7, granted, existingProjectGrantTarget('project-2'))).rejects.toThrow('choose it again')
    await expect(store.requireProjectFolder(7, granted, target, true)).resolves.toBe(granted)
    await expect(store.requireProjectFolder(7, granted, target)).rejects.toThrow('choose it again')
  })

  it('revokes every renderer grant when the vault session is cleared', async () => {
    const root = await tempRoot()
    const store = new ProjectPathCapabilityStore()
    const target = existingProjectGrantTarget('project-1')
    const granted = await store.grantFolder(7, root, 'project-local-path', target)
    store.revokeAll()
    await expect(store.requireProjectFolder(7, granted, target)).rejects.toThrow('choose it again')
  })

  it('keeps the create target distinct from a Project literally named create', async () => {
    const root = await tempRoot()
    const store = new ProjectPathCapabilityStore()
    const granted = await store.grantFolder(7, root, 'project-local-path', CREATE_PROJECT_GRANT_TARGET)
    await expect(store.requireProjectFolder(7, granted, existingProjectGrantTarget('create')))
      .rejects.toThrow('choose it again')
    await expect(store.requireProjectFolder(7, granted, CREATE_PROJECT_GRANT_TARGET, true))
      .resolves.toBe(granted)
  })

  it('uses collision-proof keys for colon-bearing Project ids and paths', async () => {
    const first = await tempRoot()
    const secondParent = await tempRoot()
    const second = join(secondParent, 'folder:with:colons')
    await mkdir(second)
    const store = new ProjectPathCapabilityStore()
    const firstTarget = existingProjectGrantTarget('project:alpha')
    const secondTarget = existingProjectGrantTarget(`project:alpha:${first}`)
    const firstGrant = await store.grantFolder(7, first, 'project-local-path', firstTarget)
    const secondGrant = await store.grantFolder(7, second, 'project-local-path', secondTarget)

    await expect(store.requireProjectFolder(7, firstGrant, firstTarget, true)).resolves.toBe(firstGrant)
    await expect(store.requireProjectFolder(7, secondGrant, secondTarget, true)).resolves.toBe(secondGrant)
  })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vaultage-project-capability-'))
  roots.push(root)
  return root
}
