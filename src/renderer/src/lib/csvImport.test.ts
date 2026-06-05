import { describe, expect, it } from 'vitest'
import {
  MAX_CSV_FIELD_BYTES,
  MAX_CSV_IMPORT_COLUMNS,
  MAX_CSV_IMPORT_ROWS,
  parseCsv,
  parseCsvTable,
  prepareBrowserRows,
  prepareRows,
  templateCsv,
} from './csvImport'

function q(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

describe('CSV import parser', () => {
  it('parses RFC-4180 quoted commas, quotes, CRLF, and multiline fields', () => {
    const csv = [
      'name,type,value,username,url,notes,scope,tags',
      [
        q('GitHub, Inc. Token'),
        'apiKey',
        q('ghp_"quoted"_token'),
        '',
        'https://github.com',
        q('line one\r\nline two'),
        'production',
        'dev;github',
      ].join(','),
    ].join('\r\n')

    const result = parseCsv(csv)

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([{
      name: 'GitHub, Inc. Token',
      type: 'apiKey',
      value: 'ghp_"quoted"_token',
      url: 'https://github.com',
      notes: 'line one\r\nline two',
      scope: 'production',
      tags: 'dev;github',
    }])
  })

  it('parses the generated template into importable rows', () => {
    const parsed = parseCsv(templateCsv())
    const prepared = prepareRows(parsed.rows)

    expect(parsed.errors).toEqual([])
    expect(prepared).toHaveLength(4)
    expect(prepared.every(row => !row.error && row.secret)).toBe(true)
  })

  it('rejects malformed and unsafe CSV input shapes', () => {
    expect(parseCsv('name,value\n"unterminated,secret').errors[0]?.message)
      .toBe('Unterminated quoted field')

    expect(parseCsv(`name,value\n${'x'.repeat(MAX_CSV_FIELD_BYTES + 1)},secret`).errors[0]?.message)
      .toContain('CSV field is too large')

    expect(parseCsv([
      Array.from({ length: MAX_CSV_IMPORT_COLUMNS + 1 }, (_, i) => `h${i}`).join(','),
      Array.from({ length: MAX_CSV_IMPORT_COLUMNS + 1 }, () => 'x').join(','),
    ].join('\n')).errors[0]?.message).toContain('CSV row has too many columns')

    expect(parseCsv([
      'name,value',
      ...Array.from({ length: MAX_CSV_IMPORT_ROWS + 1 }, (_, i) => `Secret ${i},value`),
    ].join('\n')).errors[0]?.message).toContain('CSV has too many rows')
  })

  it('handles deterministic fuzz-style quoted cell cases', () => {
    const values = [
      'plain',
      'comma,value',
      'double "quote"',
      'line\nbreak',
      'carriage\rreturn',
      'crlf\r\npair',
      'symbols !@#$%^&*()[]{}',
    ]
    const csv = [
      'name,value',
      ...values.map((value, index) => [q(`Secret ${index}`), q(value)].join(',')),
    ].join('\n')

    const parsed = parseCsv(csv)

    expect(parsed.errors).toEqual([])
    expect(parsed.rows.map(row => row.value)).toEqual(values)
  })

  it('keeps unknown headers as non-fatal warnings when required headers exist', () => {
    const parsed = parseCsv('name,value,extra\nToken,secret,ignored')

    expect(parsed.rows).toEqual([{ name: 'Token', value: 'secret' }])
    expect(parsed.errors).toEqual([{ line: 1, message: 'Unknown header "extra" — will be ignored' }])
  })

  it('imports Vaultage migration CSV exports', () => {
    const csv = [
      [
        'Folder',
        'Title',
        'Type',
        'Username',
        'Password',
        'URL',
        'Service',
        'API Key',
        'Secret',
        'Public Key',
        'Private Key',
        'Content',
        'Notes',
        'Description',
        'Scope',
        'Tags',
        'Used In',
        'Expires At',
        'Last Used At',
        'Usage Count',
        'Custom Fields',
      ].join(','),
      [
        q('My Vault / API Keys'),
        q('Stripe Live'),
        'apiKey',
        '',
        '',
        '',
        'Stripe',
        q('sk_live_test'),
        '',
        '',
        '',
        '',
        'Billing',
        'Live key',
        'production',
        'payments;stripe',
        '',
        '',
        '',
        '',
        q(JSON.stringify([
          { key: 'Service', value: 'Stripe', sensitive: false },
          { key: 'API Key', value: 'sk_live_test', sensitive: true },
          { key: 'Secret', value: 'whsec_test', sensitive: true },
        ])),
      ].join(','),
    ].join('\n')

    const parsed = parseCsv(csv)
    const prepared = prepareRows(parsed.rows)

    expect(parsed.errors).toEqual([])
    expect(prepared[0]?.error).toBeNull()
    expect(prepared[0]?.secret).toMatchObject({
      name: 'Stripe Live',
      type: 'apiKey',
      notes: 'Billing',
      scope: 'production',
      description: 'Live key',
      tags: ['payments', 'stripe'],
      fields: [
        { key: 'Service', value: 'Stripe', sensitive: false },
        { key: 'API Key', value: 'sk_live_test', sensitive: true },
        { key: 'Secret', value: 'whsec_test', sensitive: true },
      ],
    })
  })

  it('maps Chrome password export CSV rows into password secrets', () => {
    const parsed = parseCsvTable('name,url,username,password,note\nExample,https://example.com,me@example.com,pw123,Personal')
    const prepared = prepareBrowserRows(parsed.rows, 'chrome')

    expect(parsed.errors).toEqual([])
    expect(prepared[0]?.error).toBeNull()
    expect(prepared[0]?.secret).toMatchObject({
      name: 'Example',
      type: 'password',
      notes: 'Personal',
      tags: ['browser', 'chrome'],
      fields: [
        { key: 'Username', value: 'me@example.com', sensitive: false },
        { key: 'Password', value: 'pw123', sensitive: true },
        { key: 'URL', value: 'https://example.com', sensitive: false },
      ],
    })
  })

  it('maps Safari password export CSV rows including OTPAuth notes', () => {
    const parsed = parseCsvTable([
      'Title,URL,Username,Password,Notes,OTPAuth',
      'Maps,https://maps.example,eden,pw456,shared login,otpauth://totp?secret=abc',
    ].join('\n'))
    const prepared = prepareBrowserRows(parsed.rows, 'safari')

    expect(parsed.errors).toEqual([])
    expect(prepared[0]?.error).toBeNull()
    expect(prepared[0]?.secret?.name).toBe('Maps')
    expect(prepared[0]?.secret?.notes).toBe('shared login\nOTPAuth: otpauth://totp?secret=abc')
    expect(prepared[0]?.secret?.tags).toEqual(['browser', 'safari'])
  })
})
