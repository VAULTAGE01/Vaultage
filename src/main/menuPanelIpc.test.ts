import { describe, expect, it } from 'vitest'
import { searchMenuPanelSecrets } from './menuPanelSearch'

const vault = {
  root: {
    id: 'root',
    name: 'My Vault',
    secrets: [],
    children: [
      {
        id: 'api',
        name: 'API Keys',
        secrets: [
          {
            id: 'openai',
            name: 'OpenAI Project',
            type: 'apiKey',
            scope: 'development',
            tags: ['ai'],
            usageCount: 3,
            lastUsedAt: '2026-06-01T12:00:00.000Z',
            fields: [
              { key: 'API Key', value: 'sk-secret-value-that-must-not-appear', sensitive: true },
              { key: 'Project', value: 'demo', sensitive: false },
            ],
          },
          {
            id: 'stripe',
            name: 'Stripe Billing',
            type: 'apiKey',
            tags: ['payments'],
            fields: [
              { key: 'Secret Key', value: 'stripe-secret-value-that-must-not-appear', sensitive: true },
            ],
          },
        ],
        children: [],
      },
    ],
  },
}

describe('menu panel secret search', () => {
  it('returns metadata and field labels without exposing field values', () => {
    const [result] = searchMenuPanelSecrets(vault, 'openai')

    expect(result).toMatchObject({
      id: 'openai',
      name: 'OpenAI Project',
      folderPath: 'My Vault / API Keys',
      fields: [
        { key: 'API Key', sensitive: true, copyable: true },
        { key: 'Project', sensitive: false, copyable: true },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('sk-secret-value')
  })

  it('does not search secret values', () => {
    expect(searchMenuPanelSecrets(vault, 'stripe-secret-value')).toEqual([])
  })

  it('uses recent usage for empty-query ordering', () => {
    const results = searchMenuPanelSecrets(vault, '', 2)

    expect(results.map(result => result.id)).toEqual(['openai', 'stripe'])
  })
})
