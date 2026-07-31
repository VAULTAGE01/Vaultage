import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VaultRoot } from '../../types'

const fixture = vi.hoisted(() => ({
  selectFolder: vi.fn(),
  selectSecret: vi.fn(),
  vault: {
    version: 2,
    revision: 1,
    root: {
      id: 'root',
      name: 'My Vault',
      children: [
        {
          id: 'local',
          name: 'Local',
          children: [],
          secrets: [
            {
              id: 'secret-1',
              name: 'Local API key',
              type: 'api-key',
              scope: 'local',
              fields: [],
              createdAt: '2026-07-30T00:00:00.000Z',
              updatedAt: '2026-07-31T00:00:00.000Z',
              pinned: true,
            },
          ],
        },
      ],
      secrets: [],
    },
  } as unknown as VaultRoot,
}))

vi.mock('../../vaultContext', () => ({
  useVault: () => ({
    state: { vault: fixture.vault },
    selectFolder: fixture.selectFolder,
    selectSecret: fixture.selectSecret,
  }),
}))

import VaultSurface from './VaultSurface.open'

describe('Community UI2026 Vault surface', () => {
  it('composes the local Vault dashboard without closed Services content', () => {
    const html = renderToStaticMarkup(
      <VaultSurface
        embedded
        onSurfaceChange={vi.fn()}
        onOpenLegacyWorkspace={vi.fn()}
      />,
    )

    expect(html).toContain('data-ui2026-surface="vault"')
    expect(html).toContain('Vault overview')
    expect(html).toContain('Quick actions')
    expect(html).toContain('Local API key')
    expect(html).not.toContain('Services')
  })
})
