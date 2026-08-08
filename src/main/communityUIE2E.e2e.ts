import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanupAllCommunityUIE2EResources } from './communityUIE2ERun'
import { runCommunityUIE2EHappyPath } from './communityUIE2EScenario'
import { selectCommunityUIE2EScenarios } from './communityUIE2ESelection'

describe.sequential('Community hidden renderer/preload/IPC happy path', () => {
  it('proves setup, multi-vault hierarchy, sidebar drag/drop, encrypted restart, reveal, copy, and exact Project mapping', async () => {
    // Given / When
    const selected = selectCommunityUIE2EScenarios(
      process.env['VAULTAGE_COMMUNITY_E2E_SCENARIOS'],
    ).happy
    if (selected.length === 0) return
    const result = await runCommunityUIE2EHappyPath(selected.join(','))

    // Then
    expect(result.setupMilliseconds).toBeLessThan(60_000)
    expect(result.checkpoints.length).toBeGreaterThanOrEqual(2)
    expect(result.checkpoints.every(checkpoint => checkpoint.acceptedSockets === 0)).toBe(true)
    expect(result.persistence.every(observation => observation.encryptedFiles > 0)).toBe(true)
    const receipt = {
      event: 'community-ui-e2e.happy-path',
      automatedUnpackagedSetupMilliseconds: result.setupMilliseconds,
      checkpoints: result.checkpoints,
      persistence: result.persistence,
      scenarios: result.scenarios,
    }
    const receiptPath = process.env['VAULTAGE_COMMUNITY_E2E_RECEIPT']
    if (receiptPath) writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 })
    console.info(JSON.stringify(receipt))
  }, 150_000)
})

afterAll(async () => {
  await cleanupAllCommunityUIE2EResources()
})
