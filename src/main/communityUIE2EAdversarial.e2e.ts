import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import type { ElectronApplication, Page } from 'playwright-core'
import {
  installCommunityUIE2EDialog,
  invokeCommunityUIE2EApi,
  parseCommunityUIE2EApiResult,
  vaultDataDigest,
} from './communityUIE2EAdversarialProbe'
import {
  assertCommunityUIE2ECheckpoint,
  assertEncryptedCommunityProfile,
} from './communityUIE2EAssertions'
import {
  cleanupAllCommunityUIE2EResources,
  cleanupCommunityUIE2EResources,
  closeCommunityUIE2E,
  createCommunityUIE2EResources,
  launchCommunityUIE2E,
} from './communityUIE2ERun'
import { selectCommunityUIE2EScenarios } from './communityUIE2ESelection'

const SYNTHETIC_PASSWORD = 'adversarial-local-password-2026!'
const PLAINTEXT_POLICY = {
  alwaysForbidden: [SYNTHETIC_PASSWORD, 'Synthetic Cross Project'],
  auditFieldIdentifiers: [],
} as const

async function firstPage(application: ElectronApplication): Promise<Page> {
  return await application.firstWindow({ timeout: 20_000 })
}

function expectDenied(value: unknown, expectedBoundary: string): void {
  const result = parseCommunityUIE2EApiResult(value)
  expect(result.success).toBe(false)
  expect(result.error).toContain(expectedBoundary)
}

describe.sequential('Community fail-closed Project and cleanup E2E', () => {
  it('rejects canceled, substituted, cross-boundary, stale, and failed scan operations', async () => {
    // Given
    const selected = selectCommunityUIE2EScenarios(
      process.env['VAULTAGE_COMMUNITY_E2E_SCENARIOS'],
    ).adversarial
    if (selected.length === 0) return
    const resources = await createCommunityUIE2EResources()
    let application: ElectronApplication | null = null
    const denialBoundaries: string[] = []
    let checkpoints = 0
    try {
      application = await launchCommunityUIE2E(resources)
      let page = await firstPage(application)
      const setup = parseCommunityUIE2EApiResult(
        await invokeCommunityUIE2EApi(page, 'setup', SYNTHETIC_PASSWORD),
      )
      expect(setup.success).toBe(true)
      if (setup.revision === null) throw new TypeError('Community setup revision is unavailable')
      await assertCommunityUIE2ECheckpoint(application, page, resources, 'adversarial-setup')
      checkpoints += 1

      if (selected.includes('cancel')) {
        const before = vaultDataDigest(resources.run.profileDir)
        await installCommunityUIE2EDialog(application, true, [])
        expect(await invokeCommunityUIE2EApi(page, 'pickFolder', {
          purpose: 'project-local-path',
        })).toBeNull()
        expect(vaultDataDigest(resources.run.profileDir)).toBe(before)
        denialBoundaries.push('native-picker-cancel')
      }

      if (selected.includes('substitution')) {
        const before = vaultDataDigest(resources.run.profileDir)
        await installCommunityUIE2EDialog(application, false, [resources.run.projectDir])
        await invokeCommunityUIE2EApi(page, 'pickFolder', { purpose: 'project-local-path' })
        expectDenied(
          await invokeCommunityUIE2EApi(page, 'scanProject', { path: resources.run.alternateProjectDir }),
          'access expired; choose it again',
        )
        denialBoundaries.push('outside-grant')

        await installCommunityUIE2EDialog(application, false, [resources.run.alternateProjectDir])
        await invokeCommunityUIE2EApi(page, 'pickFolder', { purpose: 'scan-parent' })
        expectDenied(
          await invokeCommunityUIE2EApi(page, 'scanProject', { path: resources.run.alternateProjectDir }),
          'access expired; choose it again',
        )
        denialBoundaries.push('cross-purpose')

        await installCommunityUIE2EDialog(application, false, [resources.run.alternateProjectDir])
        await invokeCommunityUIE2EApi(page, 'pickFolder', {
          purpose: 'project-local-path',
          projectId: 'project-a',
        })
        const project = {
          id: 'project-b',
          name: 'Synthetic Cross Project',
          path: resources.run.alternateProjectDir,
          entries: [],
          addToGitignore: true,
          environments: [{
            id: 'project-b:local', name: 'Local', scope: 'development', kind: 'local',
            path: resources.run.alternateProjectDir, entries: [], addToGitignore: true,
          }],
        }
        expectDenied(await invokeCommunityUIE2EApi(page, 'mutate', {
          mutationId: '00000000-0000-4000-8000-000000000008',
          expectedRevision: setup.revision,
          command: { type: 'env-project.update', project },
        }), 'access expired; choose it again')
        expect(vaultDataDigest(resources.run.profileDir)).toBe(before)
        denialBoundaries.push('cross-project')
      }

      if (selected.includes('scan-failure')) {
        const before = vaultDataDigest(resources.run.profileDir)
        await installCommunityUIE2EDialog(application, false, [resources.run.projectDir])
        await invokeCommunityUIE2EApi(page, 'pickFolder', { purpose: 'project-local-path' })
        await installCommunityUIE2EDialog(application, false, [resources.run.manualScanFile])
        expect(await invokeCommunityUIE2EApi(page, 'pickProjectFiles')).toEqual([
          resources.run.manualScanFile,
        ])
        rmSync(resources.run.manualScanFile)
        expectDenied(await invokeCommunityUIE2EApi(page, 'scanProject', {
          path: resources.run.projectDir,
          manualFiles: [resources.run.manualScanFile],
        }), 'not a regular file')
        expect(vaultDataDigest(resources.run.profileDir)).toBe(before)
        denialBoundaries.push('scan-input-availability')
      }

      if (selected.includes('replay')) {
        const before = vaultDataDigest(resources.run.profileDir)
        await installCommunityUIE2EDialog(application, false, [resources.run.alternateProjectDir])
        await invokeCommunityUIE2EApi(page, 'pickFolder', { purpose: 'project-local-path' })
        application = await closeCommunityUIE2E(application)
        application = await launchCommunityUIE2E(resources)
        page = await firstPage(application)
        expect(parseCommunityUIE2EApiResult(
          await invokeCommunityUIE2EApi(page, 'password', SYNTHETIC_PASSWORD),
        ).success).toBe(true)
        expectDenied(
          await invokeCommunityUIE2EApi(page, 'scanProject', { path: resources.run.alternateProjectDir }),
          'access expired; choose it again',
        )
        expect(vaultDataDigest(resources.run.profileDir)).toBe(before)
        denialBoundaries.push('restart-replay')
      }

      if (application) {
        await assertCommunityUIE2ECheckpoint(application, page, resources, 'adversarial-final')
        checkpoints += 1
        application = await closeCommunityUIE2E(application)
      }
      const persistence = assertEncryptedCommunityProfile(resources.run, PLAINTEXT_POLICY)
      console.info(JSON.stringify({
        event: 'community-ui-e2e.adversarial',
        acceptedSockets: resources.sentinels.reduce((total, sentinel) => total + sentinel.accepted(), 0),
        checkpoints,
        cleanupFault: process.env['VAULTAGE_COMMUNITY_E2E_CLEANUP_FAULT'] ?? null,
        denialBoundaries,
        encryptedFiles: persistence.encryptedFiles,
        selected,
      }))
    } finally {
      await cleanupCommunityUIE2EResources(application, resources)
    }
  }, 90_000)
})

afterAll(async () => {
  await cleanupAllCommunityUIE2EResources()
})
