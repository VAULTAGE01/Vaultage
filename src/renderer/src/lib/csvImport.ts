// CSV import for secrets — parser, template, and row→secret mapping.
// Format spec:
//   name,type,value,username,url,notes,scope,tags
//   - name (required), value (required for non-secureNote)
//   - type: password | apiKey | sshKey | secureNote | custom (default: apiKey)
//   - tags: semicolon-separated (`;`) since CSV uses commas
// Supports RFC-4180 quoting: "value with, comma", "value with ""quoted"" text".

import type { SecretField, SecretType, VaultSecret } from '../types'
import { CSV_IMPORT_HEADERS } from '../../../shared/csvImportTemplate'
export { templateCsv } from '../../../shared/csvImportTemplate'

export interface CsvRow {
  name?:     string
  type?:     string
  value?:    string
  username?: string
  url?:      string
  notes?:    string
  description?: string
  scope?:    string
  tags?:     string
  usedIn?:   string
  expiresAt?: string
  lastUsedAt?: string
  usageCount?: string
  customFields?: string
}

export interface ParseResult {
  rows:   CsvRow[]
  errors: { line: number; message: string }[]
}

export interface CsvTableResult {
  headers: string[]
  rows:    Record<string, string>[]
  errors:  { line: number; message: string }[]
}

export interface PreparedSecret {
  index:   number                                                       // 0-based row index
  secret:  Omit<VaultSecret, 'id' | 'createdAt' | 'updatedAt'> | null   // null = invalid
  error:   string | null
  raw:     CsvRow
}

const REQUIRED_HEADERS = ['name', 'value']
const VALID_TYPES: SecretType[] = ['password', 'apiKey', 'sshKey', 'secureNote', 'custom']
const VAULTAGE_EXPORT_HEADERS = [
  'folder',
  'title',
  'type',
  'username',
  'password',
  'url',
  'service',
  'api key',
  'secret',
  'public key',
  'private key',
  'content',
  'notes',
  'description',
  'scope',
  'tags',
  'used in',
  'expires at',
  'last used at',
  'usage count',
  'custom fields',
]
export const MAX_CSV_IMPORT_BYTES = 512 * 1024
export const MAX_CSV_IMPORT_ROWS = 1_000
export const MAX_CSV_IMPORT_COLUMNS = 64
export const MAX_CSV_FIELD_BYTES = 64 * 1024

type ParsedCsvRow = { cells: string[]; line: number }
export type BrowserImportSource = 'chrome' | 'safari'

// ── CSV parser (RFC-4180) ─────────────────────────────────────────────────

function parseRawCsvRows(text: string): { rows: ParsedCsvRow[]; errors: ParseResult['errors'] } {
  if (byteLength(text) > MAX_CSV_IMPORT_BYTES) {
    return {
      rows: [],
      errors: [{ line: 1, message: `CSV is too large; maximum size is ${MAX_CSV_IMPORT_BYTES} bytes` }],
    }
  }

  const parsedRows: { cells: string[]; line: number }[] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  let line = 1
  let rowLine = 1

  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      if (c === '\n') line++
      else if (c === '\r') {
        line++
        if (text[i + 1] === '\n') {
          field += '\r\n'
          i += 2
          continue
        }
      }
      field += c
      i++
      continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { current.push(field); field = ''; i++; continue }
    if (c === '\n' || c === '\r') {
      current.push(field); parsedRows.push({ cells: current, line: rowLine }); current = []; field = ''
      if (c === '\r' && text[i + 1] === '\n') i += 2; else i++
      line++
      rowLine = line
      continue
    }
    field += c
    i++
  }
  if (inQuotes) {
    return { rows: [], errors: [{ line: rowLine, message: 'Unterminated quoted field' }] }
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field)
    parsedRows.push({ cells: current, line: rowLine })
  }

  return { rows: parsedRows, errors: [] }
}

function normaliseHeader(value: string, index: number): string {
  return (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim().toLowerCase()
}

export function parseCsvTable(text: string): CsvTableResult {
  const raw = parseRawCsvRows(text)
  if (raw.errors.length > 0) return { headers: [], rows: [], errors: raw.errors }

  const errors: { line: number; message: string }[] = []
  const nonEmpty = raw.rows.filter(r => r.cells.some(c => c.trim() !== ''))
  if (nonEmpty.length === 0) return { headers: [], rows: [], errors: [{ line: 1, message: 'Empty file' }] }

  const limitErrors = validateCsvShape(nonEmpty)
  if (limitErrors.length > 0) return { headers: [], rows: [], errors: limitErrors }

  const headers = nonEmpty[0].cells.map(normaliseHeader)
  const dataRows: Record<string, string>[] = []
  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = nonEmpty[r].cells
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      const k = headers[j]
      if (!k) continue
      const v = (cells[j] ?? '').trim()
      if (v) obj[k] = v
    }
    dataRows.push(obj)
  }

  return { headers, rows: dataRows, errors }
}

export function parseCsv(text: string): ParseResult {
  const table = parseCsvTable(text)
  if (table.errors.some(e => e.message === 'Empty file' || e.message.startsWith('CSV') || e.message === 'Unterminated quoted field')) {
    return { rows: [], errors: table.errors }
  }

  const errors = [...table.errors]
  const headers = table.headers
  if (isVaultageExportCsv(headers)) {
    return {
      rows: table.rows.map(exportedRowToCsvRow),
      errors,
    }
  }

  for (const req of REQUIRED_HEADERS) {
    if (!headers.includes(req)) errors.push({ line: 1, message: `Missing required header: "${req}"` })
  }
  for (const h of headers) {
    if (!CSV_IMPORT_HEADERS.includes(h)) errors.push({ line: 1, message: `Unknown header "${h}" — will be ignored` })
  }
  if (errors.some(e => e.message.startsWith('Missing'))) return { rows: [], errors }

  const dataRows: CsvRow[] = table.rows.map(record => {
    const obj: CsvRow = {}
    for (const k of headers) {
      if (!CSV_IMPORT_HEADERS.includes(k)) continue
      const v = record[k]
      if (v) (obj as Record<string, string>)[k] = v.trim()
    }
    return obj
  })

  return { rows: dataRows, errors }
}

function isVaultageExportCsv(headers: string[]): boolean {
  return VAULTAGE_EXPORT_HEADERS.every(header => headers.includes(header))
}

function exportedRowToCsvRow(record: Record<string, string>): CsvRow {
  const type = normalizeType(record.type)
  const value = exportedValueForType(record, type)
  return {
    name: record.title,
    type,
    value,
    username: type === 'apiKey' ? record.service : record.username,
    url: record.url,
    notes: record.notes,
    description: record.description,
    scope: record.scope,
    tags: record.tags,
    usedIn: record['used in'],
    expiresAt: record['expires at'],
    lastUsedAt: record['last used at'],
    usageCount: record['usage count'],
    customFields: record['custom fields'],
  }
}

function exportedValueForType(record: Record<string, string>, type?: string): string | undefined {
  switch (type) {
    case 'password': return record.password
    case 'apiKey': return record['api key'] || record.secret
    case 'sshKey': return record['private key'] || record['public key']
    case 'secureNote': return record.content || record.notes
    default:
      return record.secret ||
        record['api key'] ||
        record.password ||
        record['private key'] ||
        record.content
  }
}

function validateCsvShape(rows: { cells: string[]; line: number }[]): ParseResult['errors'] {
  const errors: ParseResult['errors'] = []
  if (rows.length - 1 > MAX_CSV_IMPORT_ROWS) {
    errors.push({ line: rows[MAX_CSV_IMPORT_ROWS + 1]?.line ?? 1, message: `CSV has too many rows; maximum is ${MAX_CSV_IMPORT_ROWS}` })
  }

  for (const row of rows) {
    if (row.cells.length > MAX_CSV_IMPORT_COLUMNS) {
      errors.push({ line: row.line, message: `CSV row has too many columns; maximum is ${MAX_CSV_IMPORT_COLUMNS}` })
    }
    for (const cell of row.cells) {
      if (byteLength(cell) > MAX_CSV_FIELD_BYTES) {
        errors.push({ line: row.line, message: `CSV field is too large; maximum is ${MAX_CSV_FIELD_BYTES} bytes` })
        break
      }
    }
    if (errors.length >= 10) break
  }
  return errors
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

// ── Row → Secret ─────────────────────────────────────────────────────────

function normalizeType(t?: string): string | undefined {
  if (!t) return undefined
  const s = t.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (s === 'apikey') return 'apiKey'
  if (s === 'sshkey') return 'sshKey'
  if (s === 'password') return 'password'
  if (s === 'securenote') return 'secureNote'
  if (s === 'custom') return 'custom'
  return t
}

export function rowToSecret(row: CsvRow): PreparedSecret['secret'] {
  if (!row.name) return null
  const rawType = normalizeType(row.type)
  const type = (VALID_TYPES.includes(rawType as SecretType) ? rawType : 'apiKey') as SecretType
  const exportedFields = parseExportedFields(row.customFields)
  if (type !== 'secureNote' && !row.value && exportedFields.length === 0) return null

  let fields: SecretField[]
  if (exportedFields.length > 0) {
    fields = exportedFields
  } else switch (type) {
    case 'password':
      fields = [
        { key: 'Username', value: row.username ?? '', sensitive: false },
        { key: 'Password', value: row.value ?? '',    sensitive: true  },
        { key: 'URL',      value: row.url ?? '',      sensitive: false },
      ]
      break
    case 'apiKey':
      fields = [
        { key: 'Service', value: row.username ?? '', sensitive: false },
        { key: 'API Key', value: row.value ?? '',    sensitive: true  },
      ]
      break
    case 'sshKey':
      fields = [
        { key: 'Private Key', value: row.value ?? '', sensitive: true },
      ]
      break
    case 'secureNote':
      fields = [
        { key: 'Content', value: row.notes ?? row.value ?? '', sensitive: true },
      ]
      break
    default:
      fields = [{ key: 'Value', value: row.value ?? '', sensitive: true }]
  }

  if (type === 'secureNote') {
    fields = fields.map(field => ({ ...field, sensitive: true }))
  }

  return {
    name:        row.name,
    type,
    fields,
    notes:       row.notes ?? '',
    scope:       row.scope || undefined,
    tags:        row.tags ? row.tags.split(';').map(t => t.trim()).filter(Boolean) : undefined,
    description: row.description || undefined,
    expiresAt:   row.expiresAt || undefined,
    usedIn:      row.usedIn ? row.usedIn.split(';').map(t => t.trim()).filter(Boolean) : undefined,
    lastUsedAt:  row.lastUsedAt || undefined,
    usageCount:  row.usageCount && Number.isFinite(Number(row.usageCount)) ? Number(row.usageCount) : undefined,
  }
}

function parseExportedFields(value?: string): SecretField[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((field): field is Record<string, unknown> => Boolean(field && typeof field === 'object' && !Array.isArray(field)))
      .map(field => ({
        key: typeof field.key === 'string' && field.key.trim() ? field.key : 'Value',
        value: typeof field.value === 'string' ? field.value : '',
        sensitive: field.sensitive === true,
      }))
  } catch {
    return []
  }
}

export function prepareRows(rows: CsvRow[]): PreparedSecret[] {
  return rows.map((raw, index) => {
    const rawType = normalizeType(raw.type)
    const secret = rowToSecret(raw)
    let error: string | null = null
    if (!raw.name)                                  error = 'Missing name'
    else if (rawType === 'image')                 error = 'Images require JSON or image import'
    else if (rawType && !VALID_TYPES.includes(rawType as SecretType)) error = `Unknown type "${raw.type}"`
    else if (!secret)                               error = 'Missing value'
    return { index, raw, secret, error }
  })
}

// ── Browser CSV exports ───────────────────────────────────────────────────

export function prepareBrowserRows(rows: Record<string, string>[], source: BrowserImportSource): PreparedSecret[] {
  return rows.map((rawRecord, index) => {
    const row = browserRowToCsvRow(rawRecord, source)
    const secret = rowToSecret(row)
    let error: string | null = null
    if (!row.name) error = 'Missing title'
    else if (!row.url && !row.username) error = 'Missing URL or username'
    else if (!row.value) error = 'Missing password'
    return { index, raw: row, secret, error }
  })
}

function browserRowToCsvRow(row: Record<string, string>, source: BrowserImportSource): CsvRow {
  const url = getFirst(row, ['url', 'origin', 'website'])
  const username = getFirst(row, ['username', 'user', 'login', 'email'])
  const password = getFirst(row, ['password', 'pass'])
  const notes = getFirst(row, ['notes', 'note'])
  const otpAuth = getFirst(row, ['otpauth', 'otp', 'totp'])
  const title = source === 'safari'
    ? getFirst(row, ['title', 'name'])
    : getFirst(row, ['name', 'title'])
  const name = title || hostLabel(url) || username || 'Imported Password'

  return {
    name,
    type:  'password',
    value: password,
    username,
    url,
    notes: [notes, otpAuth ? `OTPAuth: ${otpAuth}` : ''].filter(Boolean).join('\n'),
    tags:  `browser;${source}`,
  }
}

function getFirst(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (value) return value
  }
  return undefined
}

function hostLabel(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
