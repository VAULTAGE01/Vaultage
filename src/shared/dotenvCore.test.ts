import { describe, expect, it } from 'vitest'
import { formatDotenvEntries, formatDotenvValue } from './dotenvCore'

describe('formatDotenvValue', () => {
  it('leaves shell-inert values unquoted', () => {
    expect(formatDotenvValue('sk-live-abc123')).toBe('sk-live-abc123')
    expect(formatDotenvValue('https://api.example.com/v1')).toBe('https://api.example.com/v1')
    expect(formatDotenvValue('a+b=c,d')).toBe('a+b=c,d')
  })

  it('quotes the empty value so the assignment stays unambiguous', () => {
    expect(formatDotenvValue('')).toBe('""')
  })

  it('neutralises expansion and command substitution in saved field values', () => {
    expect(formatDotenvValue('p$ssw0rd')).toBe('"p\\$ssw0rd"')
    expect(formatDotenvValue('$HOME')).toBe('"\\$HOME"')
    expect(formatDotenvValue('${SECRET}')).toBe('"\\${SECRET}"')
    expect(formatDotenvValue('`id`')).toBe('"\\`id\\`"')
  })

  it('quotes values a naive parser would truncate or reinterpret', () => {
    expect(formatDotenvValue('has space')).toBe('"has space"')
    expect(formatDotenvValue('trailing # comment')).toBe('"trailing # comment"')
    expect(formatDotenvValue('has"quote')).toBe('"has\\"quote"')
    expect(formatDotenvValue('back\\slash')).toBe('"back\\\\slash"')
  })

  it('keeps a multi-line value on one physical line', () => {
    expect(formatDotenvValue('line1\nline2')).toBe('"line1\\nline2"')
    expect(formatDotenvValue('crlf\r\n')).toBe('"crlf\\r\\n"')
  })
})

describe('formatDotenvEntries', () => {
  it('writes one assignment per line under an optional header', () => {
    expect(formatDotenvEntries(
      [{ envKey: 'API_KEY', value: 'sk-test' }, { envKey: 'DB_URL', value: 'p$ss' }],
      { header: '# Generated' },
    )).toBe('# Generated\nAPI_KEY=sk-test\nDB_URL="p\\$ss"\n')
  })

  it('terminates a written file with a trailing newline', () => {
    expect(formatDotenvEntries([{ envKey: 'ONLY', value: 'x' }])).toBe('ONLY=x\n')
    expect(formatDotenvEntries([])).toBe('')
  })
})
