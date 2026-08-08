import { describe, expect, it } from 'vitest'
import { selectCommunityUIE2EScenarios } from './communityUIE2ESelection'

describe('Community UI E2E scenario selection', () => {
  it('routes the exact adversarial scenario list without collecting happy-path cases', () => {
    // Given
    const raw = 'cancel,substitution,replay,scan-failure,offline,lifecycle,cleanup'

    // When
    const selected = selectCommunityUIE2EScenarios(raw)

    // Then
    expect(selected.happy).toEqual([])
    expect(selected.adversarial).toEqual([
      'cancel', 'substitution', 'replay', 'scan-failure', 'cleanup',
    ])
    expect(selected.policy).toEqual(['offline', 'lifecycle'])
  })

  it('rejects duplicate and unsupported cases', () => {
    // Given / When / Then
    expect(() => selectCommunityUIE2EScenarios('cancel,cancel')).toThrow()
    expect(() => selectCommunityUIE2EScenarios('cancel,unsupported')).toThrow()
  })

  it('routes sidebar drag and drop through the native happy path', () => {
    expect(selectCommunityUIE2EScenarios('sidebar-drag-drop')).toEqual({
      adversarial: [],
      happy: ['sidebar-drag-drop'],
      policy: [],
    })
  })

  it('routes multi-vault hierarchy through the native happy path', () => {
    expect(selectCommunityUIE2EScenarios('multi-vault')).toEqual({
      adversarial: [],
      happy: ['multi-vault'],
      policy: [],
    })
  })
})
