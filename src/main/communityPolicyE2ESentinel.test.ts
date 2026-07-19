import { describe, expect, it } from 'vitest'
import { startCommunityPolicySentinel } from './communityPolicyE2ESentinel'

describe('Community policy E2E sentinel cleanup', () => {
  it('allows the cleanup backstop to close an already-closed sentinel', async () => {
    // Given
    const sentinel = await startCommunityPolicySentinel('http')
    await sentinel.close()

    // When / Then
    await expect(sentinel.close()).resolves.toBeUndefined()
  })
})
