import { describe, expect, it } from 'vitest'
import {
  MAX_ENV_ENTRIES,
  MAX_ENV_VALUE_BYTES,
  MAX_PASSWORD_BYTES,
  MAX_VAULT_JSON_BYTES,
  buildCustomProviderUrl,
  isAppMode,
  isBrowserOriginRequest,
  serializeDotenvValue,
  serializeEnvFile,
  validateCustomHeaderName,
  validateCustomProviderBaseUrl,
  validateAgentApprovalConfirmation,
  validateEnvEntries,
  validateMasterPasswordInput,
  validatePasswordInput,
  validatePlaintextExportConfirmation,
  validateProjectPath,
  validateQuickRevealPinInput,
  validateSecretRequestPayload,
  validateSecretRevealConfirmation,
  validateVaultSaveJson,
} from './security'

describe('main security policy helpers', () => {
  it('accepts only known app modes', () => {
    expect(isAppMode('local')).toBe(true)
    expect(isAppMode('agent')).toBe(true)
    expect(isAppMode('broker')).toBe(true)
    expect(isAppMode('cloud')).toBe(false)
    expect(isAppMode(null)).toBe(false)
  })

  it('detects requests that originate from a browser context', () => {
    expect(isBrowserOriginRequest({})).toBe(false)
    expect(isBrowserOriginRequest({ origin: 'http://localhost:5173' })).toBe(true)
    expect(isBrowserOriginRequest({ 'sec-fetch-site': 'same-origin' })).toBe(true)
    expect(isBrowserOriginRequest({ 'sec-fetch-mode': 'cors' })).toBe(true)
    expect(isBrowserOriginRequest({ 'sec-fetch-dest': 'empty' })).toBe(true)
  })

  it('accepts only absolute local project paths', () => {
    expect(validateProjectPath('/Users/eden/project')).toBe('/Users/eden/project')
    expect(validateProjectPath('/Users/eden/../eden/project')).toBe('/Users/eden/project')
    expect(validateProjectPath('relative/project')).toBeNull()
    expect(validateProjectPath('/tmp/project\0evil')).toBeNull()
    expect(validateProjectPath('   ')).toBeNull()
  })

  it('validates and normalizes an agent secret request', () => {
    const result = validateSecretRequestPayload({
      requestor: '  Claude Code\n',
      project: '/Users/eden/project/../project',
      keys: ['OPENAI_API_KEY', 'OPENAI_API_KEY', '_INTERNAL'],
      reason: ' local dev ',
      delivery: 'process',
      command: ['npm', 'run', 'dev'],
    })

    expect(result).toEqual({
      ok: true,
      requestor: 'Claude Code',
      project: '/Users/eden/project',
      keys: ['OPENAI_API_KEY', '_INTERNAL'],
      reason: 'local dev',
      delivery: 'process',
      command: ['npm', 'run', 'dev'],
    })
  })

  it('rejects malformed agent secret requests', () => {
    expect(validateSecretRequestPayload(null)).toEqual({
      ok: false,
      error: 'Request body must be a JSON object',
    })
    expect(validateSecretRequestPayload({ project: 'relative/path' })).toEqual({
      ok: false,
      error: 'project must be an absolute local path',
    })
    expect(validateSecretRequestPayload({ keys: [] })).toEqual({
      ok: false,
      error: 'keys must not be empty',
    })
    expect(validateSecretRequestPayload({ keys: ['GOOD', 'bad-key'] })).toEqual({
      ok: false,
      error: 'Invalid env key: bad-key',
    })
    expect(validateSecretRequestPayload({ keys: Array.from({ length: MAX_ENV_ENTRIES + 1 }, (_, i) => `KEY_${i}`) })).toEqual({
      ok: false,
      error: 'too many requested keys',
    })
    expect(validateSecretRequestPayload({ delivery: 'browser' })).toEqual({
      ok: false,
      error: 'Invalid delivery mode',
    })
    expect(validateSecretRequestPayload({ command: [] })).toEqual({
      ok: false,
      error: 'command must not be empty',
    })
  })

  it('validates env entries before writing or releasing secrets', () => {
    expect(validateEnvEntries([
      { envKey: 'OPENAI_API_KEY', value: 'sk-test' },
      { envKey: '_PRIVATE', value: '' },
    ])).toEqual([
      { envKey: 'OPENAI_API_KEY', value: 'sk-test' },
      { envKey: '_PRIVATE', value: '' },
    ])

    expect(() => validateEnvEntries({})).toThrow('entries must be an array')
    expect(() => validateEnvEntries([{ envKey: 'bad-key', value: 'x' }])).toThrow('Invalid env key: bad-key')
    expect(() => validateEnvEntries([{ envKey: 'GOOD', value: 42 }])).toThrow('Invalid value for GOOD')
    expect(() => validateEnvEntries(Array.from({ length: MAX_ENV_ENTRIES + 1 }, (_, i) => ({ envKey: `KEY_${i}`, value: 'x' })))).toThrow('too many env entries')
    expect(() => validateEnvEntries([{ envKey: 'HUGE', value: 'x'.repeat(MAX_ENV_VALUE_BYTES + 1) }])).toThrow('Value too large for HUGE')
  })

  it('validates plaintext export confirmation phrases', () => {
    expect(validatePlaintextExportConfirmation('EXPORT PLAINTEXT')).toBe(true)
    expect(validatePlaintextExportConfirmation('export plaintext')).toBe(false)
    expect(validatePlaintextExportConfirmation(undefined)).toBe(false)
  })

  it('validates typed agent approval phrases', () => {
    expect(validateAgentApprovalConfirmation('APPROVE AGENT')).toBe(true)
    expect(validateAgentApprovalConfirmation('approve agent')).toBe(false)
    expect(validateAgentApprovalConfirmation(undefined)).toBe(false)
  })

  it('validates typed secret reveal phrases', () => {
    expect(validateSecretRevealConfirmation('REVEAL SECRET')).toBe(true)
    expect(validateSecretRevealConfirmation('reveal secret')).toBe(false)
    expect(validateSecretRevealConfirmation(undefined)).toBe(false)
  })

  it('accepts only 4-digit quick reveal PINs', () => {
    expect(validateQuickRevealPinInput('1234')).toBe('1234')
    expect(() => validateQuickRevealPinInput('123')).toThrow('PIN must be exactly 4 digits')
    expect(() => validateQuickRevealPinInput('12345')).toThrow('PIN must be exactly 4 digits')
    expect(() => validateQuickRevealPinInput('12a4')).toThrow('PIN must be exactly 4 digits')
    expect(() => validateQuickRevealPinInput(undefined)).toThrow('PIN must be a string')
  })

  it('validates password-bearing IPC input before crypto work', () => {
    expect(validatePasswordInput('correct horse battery staple')).toBe('correct horse battery staple')
    expect(() => validatePasswordInput(undefined)).toThrow('password must be a string')
    expect(() => validatePasswordInput('')).toThrow('password is required')
    expect(() => validatePasswordInput('x'.repeat(MAX_PASSWORD_BYTES + 1))).toThrow('password is too large')
    expect(() => validatePasswordInput(42, 'current password')).toThrow('current password must be a string')
  })

  it('enforces master password policy in main', () => {
    expect(validateMasterPasswordInput('correct horse battery staple', 'master password')).toBe('correct horse battery staple')
    expect(() => validateMasterPasswordInput('short', 'master password')).toThrow('master password must be at least 12 characters')
    expect(() => validateMasterPasswordInput('password1234', 'master password')).toThrow('master password is too common')
    expect(() => validateMasterPasswordInput('aaaaaaaaaaaa', 'master password')).toThrow('master password cannot be one repeated character')
  })

  it('validates vault save payloads before encrypted writes', () => {
    const json = JSON.stringify({
      version: 2,
      revision: 1,
      root: { id: 'root', name: 'Vault', children: [], secrets: [] },
      providers: [],
      envProjects: [],
    })

    expect(validateVaultSaveJson(json)).toBe(json)
    expect(() => validateVaultSaveJson({})).toThrow('Vault payload must be a JSON string')
    expect(() => validateVaultSaveJson('{bad json')).toThrow('Vault payload must be valid JSON')
    expect(() => validateVaultSaveJson('[]')).toThrow('Vault payload must be a JSON object')
    expect(() => validateVaultSaveJson(JSON.stringify({ version: '2', root: {} }))).toThrow('Vault payload version must be a number')
    expect(() => validateVaultSaveJson(JSON.stringify({ version: 2, revision: 0, root: {} }))).toThrow('Vault payload revision must be a positive integer')
    expect(() => validateVaultSaveJson(JSON.stringify({ version: 2 }))).toThrow('Vault payload root must be an object')
    expect(() => validateVaultSaveJson(JSON.stringify({ version: 2, root: {}, padding: 'x'.repeat(MAX_VAULT_JSON_BYTES) }))).toThrow('Vault payload is too large')
  })

  it('serializes dotenv safely', () => {
    expect(serializeDotenvValue('abc_123./:@%+=,-')).toBe('abc_123./:@%+=,-')
    expect(serializeDotenvValue('')).toBe('""')
    expect(serializeDotenvValue('needs spaces')).toBe('"needs spaces"')
    expect(serializeDotenvValue('line\nbreak')).toBe('"line\\nbreak"')
    expect(serializeDotenvValue('uses $TOKEN and `cmd`')).toBe('"uses \\$TOKEN and \\`cmd\\`"')
    expect(serializeDotenvValue('quote"slash\\')).toBe('"quote\\"slash\\\\"')
    expect(serializeEnvFile([
      { envKey: 'SAFE', value: 'abc123' },
      { envKey: 'MULTILINE', value: 'line\nbreak' },
    ])).toBe('# Generated by Vaultage - do not commit this file\nSAFE=abc123\nMULTILINE="line\\nbreak"\n')
  })

  it('constrains Custom REST provider URLs', () => {
    expect(validateCustomProviderBaseUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(validateCustomProviderBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(validateCustomProviderBaseUrl('https://localhost:8787')).toBe('https://localhost:8787')

    expect(() => validateCustomProviderBaseUrl('http://api.example.com')).toThrow('must use HTTPS')
    expect(() => validateCustomProviderBaseUrl('https://api.example.com')).toThrow('remote host is not allowed')
    expect(() => validateCustomProviderBaseUrl('https://token@example.com')).toThrow('must not include credentials')
    expect(() => validateCustomProviderBaseUrl('not a url')).toThrow('base URL is invalid')
  })

  it('allows explicitly configured Custom REST provider remote hosts', () => {
    const previous = process.env['VAULTAGE_CUSTOM_PROVIDER_HOSTS']
    process.env['VAULTAGE_CUSTOM_PROVIDER_HOSTS'] = 'api.example.com'
    try {
      expect(validateCustomProviderBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
      expect(() => validateCustomProviderBaseUrl('https://other.example.com')).toThrow('remote host is not allowed')
    } finally {
      if (previous === undefined) delete process.env['VAULTAGE_CUSTOM_PROVIDER_HOSTS']
      else process.env['VAULTAGE_CUSTOM_PROVIDER_HOSTS'] = previous
    }
  })

  it('keeps Custom REST paths relative to the configured base URL', () => {
    expect(buildCustomProviderUrl('http://localhost:8787/v1', '/secrets', '/fallback')).toBe('http://localhost:8787/v1/secrets')
    expect(buildCustomProviderUrl('http://localhost:8787/v1/', '', '/fallback')).toBe('http://localhost:8787/v1/fallback')

    expect(() => buildCustomProviderUrl('http://localhost:8787', 'https://evil.example.com/secrets', '/fallback')).toThrow('relative to the configured base URL')
    expect(() => buildCustomProviderUrl('http://localhost:8787', '//evil.example.com/secrets', '/fallback')).toThrow('relative to the configured base URL')
    expect(() => buildCustomProviderUrl('http://localhost:8787', 'secrets', '/fallback')).toThrow('must start with /')
  })

  it('validates Custom REST auth header names', () => {
    expect(validateCustomHeaderName('X-Api-Key')).toBe('X-Api-Key')
    expect(validateCustomHeaderName('', 'Authorization')).toBe('Authorization')
    expect(() => validateCustomHeaderName('Bad Header')).toThrow('header name is invalid')
    expect(() => validateCustomHeaderName('X-Api-Key\nInjected')).toThrow('header name is invalid')
  })
})
