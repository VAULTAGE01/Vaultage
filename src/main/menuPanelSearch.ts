import type {
  MenuPanelSearchField,
  MenuPanelSearchResult,
} from '../shared/menuPanelIpcContracts'

const DEFAULT_SEARCH_LIMIT = 12
const MAX_SEARCH_LIMIT = 24

export function searchMenuPanelSecrets(vault: unknown, query: string, limit = DEFAULT_SEARCH_LIMIT): MenuPanelSearchResult[] {
  const root = isRecord(vault) ? vault.root : null
  if (!isRecord(root)) return []

  const normalizedQuery = normalizeQuery(query)
  const max = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit || DEFAULT_SEARCH_LIMIT)))
  const matches: Array<MenuPanelSearchResult & { score: number }> = []

  walkFolder(root, 'My Vault', (secret, folderPath) => {
    const result = menuPanelResultForSecret(secret, folderPath)
    if (!result) return
    const score = scoreSearchResult(result, normalizedQuery)
    if (score <= 0) return
    matches.push({ ...result, score })
  })

  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const usedDelta = timestamp(b.lastUsedAt) - timestamp(a.lastUsedAt)
      if (usedDelta !== 0) return usedDelta
      const countDelta = (b.usageCount ?? 0) - (a.usageCount ?? 0)
      if (countDelta !== 0) return countDelta
      return a.name.localeCompare(b.name)
    })
    .slice(0, max)
    .map(({ score: _score, ...result }) => result)
}

function menuPanelResultForSecret(secret: Record<string, unknown>, folderPath: string): MenuPanelSearchResult | null {
  if (typeof secret.id !== 'string' || typeof secret.name !== 'string') return null
  const fields = Array.isArray(secret.fields)
    ? secret.fields
        .filter(isRecord)
        .map(field => menuPanelField(field))
        .filter((field): field is MenuPanelSearchField => Boolean(field))
    : []
  return {
    id: secret.id,
    name: cleanText(secret.name, 120),
    type: cleanText(typeof secret.type === 'string' ? secret.type : 'custom', 40),
    folderPath,
    scope: typeof secret.scope === 'string' ? cleanText(secret.scope, 80) : undefined,
    tags: Array.isArray(secret.tags)
      ? secret.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => cleanText(tag, 40)).slice(0, 8)
      : [],
    lastUsedAt: typeof secret.lastUsedAt === 'string' ? secret.lastUsedAt : undefined,
    usageCount: typeof secret.usageCount === 'number' && Number.isFinite(secret.usageCount)
      ? Math.max(0, Math.floor(secret.usageCount))
      : undefined,
    fields,
  }
}

function menuPanelField(field: Record<string, unknown>): MenuPanelSearchField | null {
  if (typeof field.key !== 'string' || field.key.trim() === '') return null
  return {
    id: typeof field.id === 'string' ? cleanText(field.id, 240) : undefined,
    key: cleanText(field.key, 80),
    sensitive: field.sensitive === true,
    copyable: typeof field.value === 'string' && field.value.length > 0,
  }
}

function scoreSearchResult(result: MenuPanelSearchResult, query: string): number {
  if (!query) {
    return 1 + Math.min(10, result.usageCount ?? 0) + (timestamp(result.lastUsedAt) > 0 ? 5 : 0)
  }

  const haystacks = [
    { value: result.name, weight: 12 },
    { value: result.folderPath, weight: 5 },
    { value: result.type, weight: 3 },
    { value: result.scope ?? '', weight: 3 },
    ...result.tags.map(tag => ({ value: tag, weight: 4 })),
    ...result.fields.map(field => ({ value: field.key, weight: 2 })),
  ]

  let score = 0
  for (const haystack of haystacks) {
    const normalized = normalizeQuery(haystack.value)
    if (!normalized) continue
    if (normalized === query) score += haystack.weight * 3
    else if (normalized.startsWith(query)) score += haystack.weight * 2
    else if (normalized.includes(query)) score += haystack.weight
  }
  return score
}

function walkFolder(folder: Record<string, unknown>, path: string, visit: (secret: Record<string, unknown>, folderPath: string) => void): void {
  const name = typeof folder.name === 'string' && folder.name.trim() ? folder.name.trim() : 'Folder'
  const folderPath = path === 'My Vault' && name === 'My Vault' ? name : `${path} / ${name}`

  if (Array.isArray(folder.secrets)) {
    for (const secret of folder.secrets) {
      if (isRecord(secret)) visit(secret, folderPath)
    }
  }
  if (Array.isArray(folder.children)) {
    for (const child of folder.children) {
      if (isRecord(child)) walkFolder(child, folderPath, visit)
    }
  }
}

function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_./-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function timestamp(value?: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
