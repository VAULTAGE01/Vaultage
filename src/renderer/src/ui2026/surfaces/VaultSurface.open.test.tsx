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
            {
              id: 'certificate-1',
              name: 'Gateway certificate',
              type: 'certificate',
              scope: 'local',
              fields: [],
              createdAt: '2026-07-30T00:00:00.000Z',
              updatedAt: '2026-07-31T00:00:00.000Z',
              certificate: {
                format: 'PEM',
                notBefore: new Date(Date.now() - 86_400_000).toISOString(),
                notAfter: new Date(Date.now() + 10 * 86_400_000).toISOString(),
              },
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

const emptyVault: VaultRoot = {
  version: 2,
  revision: 1,
  providers: [],
  envProjects: [],
  root: {
    id: 'root',
    name: 'My Vault',
    children: [],
    secrets: [],
  },
}

describe('Community UI2026 Vault surface', () => {
  it('composes the local Vault dashboard without closed Services content', () => {
    const html = renderToStaticMarkup(
      <VaultSurface
        embedded
        onSurfaceChange={vi.fn()}
      />,
    )

    expect(html).toContain('data-ui2026-surface="vault"')
    expect(html).toContain('data-ui26-dashboard-surface="vault"')
    expect(html).toContain('data-ui26-dashboard-slot-state="onboarding"')
    expect(html).toContain('Quick actions')
    expect(html).toContain('Local API key')
    expect(html).toContain('Gateway certificate')
    expect(html).toContain('Certificate expires')
    expect(html).not.toContain('Services')
  })

  it('keeps the full dashboard shell when the Vault has no secrets', () => {
    const populatedVault = fixture.vault
    fixture.vault = emptyVault

    const html = renderToStaticMarkup(
      <VaultSurface embedded onSurfaceChange={vi.fn()} />,
    )

    fixture.vault = populatedVault

    expect(html).toContain('data-ui26-dashboard-surface="vault"')
    expect(html).toContain('data-ui26-dashboard-slot="metrics"')
    expect(html).toContain('Pinned Vault items')
    expect(html).toContain('Quick actions')
    expect(html).toContain('Issues / reminders')
    expect(html.match(/class="ui26-dashboard-panel"/g)).toHaveLength(3)
    expect(html).not.toContain('class="ui26-dashboard-module"')
    expect(html).not.toContain('Start your secure vault')
  })
})
