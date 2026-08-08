import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverProjectCandidates, parseDotenvAssignments, parseDotenvValue, scanProject } from './projectScanner'
import { serializeEnvFile } from './security'

let tempRoot: string | null = null

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('project scanner discovery', () => {
  it('finds project-like child folders under a selected parent folder', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-project-discovery-'))
    const appDir = join(tempRoot, 'checkout-app')
    const notesDir = join(tempRoot, 'notes')
    await mkdir(appDir)
    await mkdir(notesDir)
    await writeFile(join(appDir, 'package.json'), '{"dependencies":{"openai":"latest"}}')
    await writeFile(join(appDir, '.env.local'), 'OPENAI_API_KEY=sk-test\n')
    await writeFile(join(notesDir, 'todo.txt'), 'not a project\n')

    const result = await discoverProjectCandidates({ parentPath: tempRoot })

    const canonicalRoot = await realpath(tempRoot)
    expect(result.parentPath).toBe(canonicalRoot)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      path: await realpath(appDir),
      name: 'checkout-app',
      envKeyCount: 1,
      envFileCount: 1,
    })
    expect(result.candidates[0].services).toContain('OpenAI')
  })

  it('authorizes each discovery candidate before scanning it', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-project-discovery-policy-'))
    const appDir = join(tempRoot, 'checkout-app')
    await mkdir(appDir)
    await writeFile(join(appDir, 'package.json'), '{"name":"checkout-app"}')
    const acquireCandidateLease = vi.fn(async () => {
      throw new Error('The Free plan active-project limit is full')
    })

    await expect(discoverProjectCandidates(
      { parentPath: tempRoot },
      { acquireCandidateLease },
    )).rejects.toThrow('active-project limit is full')
    expect(acquireCandidateLease).toHaveBeenCalledWith(await realpath(appDir))
  })

  it('withholds discovery results when candidate authorization changes during scanning', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-project-discovery-lease-'))
    const appDir = join(tempRoot, 'checkout-app')
    await mkdir(appDir)
    await writeFile(join(appDir, 'package.json'), '{"name":"checkout-app"}')

    await expect(discoverProjectCandidates(
      { parentPath: tempRoot },
      {
        acquireCandidateLease: async () => ({
          assertCurrent: async () => { throw new Error('Project scan authorization changed; try again') },
        }),
      },
    )).rejects.toThrow('Project scan authorization changed')
  })

  it('parses quoted hashes and escapes without treating them as comments', () => {
    expect(parseDotenvValue('"abc # still-value" # comment')).toBe('abc # still-value')
    expect(parseDotenvValue("'abc # literal' # comment")).toBe('abc # literal')
    expect(parseDotenvValue('abc # comment')).toBe('abc')
    expect(parseDotenvValue('abc#part-of-value')).toBe('abc#part-of-value')
    expect(parseDotenvValue('"line\\nnext\\tcolumn"')).toBe('line\nnext\tcolumn')
    expect(parseDotenvAssignments('MULTILINE="first\nsecond # value"\nNEXT=ok')).toEqual([
      { key: 'MULTILINE', value: 'first\nsecond # value', line: 1 },
      { key: 'NEXT', value: 'ok', line: 3 },
    ])
  })

  it('decodes the shell-safety escapes Vaultage writes into exported .env files', () => {
    expect(parseDotenvValue('"p\\$ssw0rd"')).toBe('p$ssw0rd')
    expect(parseDotenvValue('"\\`backtick\\`"')).toBe('`backtick`')
    expect(parseDotenvValue('"postgres://user:p\\$ss@db.example.com:5432/app"'))
      .toBe('postgres://user:p$ss@db.example.com:5432/app')
    expect(parseDotenvValue("'p\\$ssw0rd'")).toBe('p\\$ssw0rd')
    expect(parseDotenvValue('"drop\\qzero"')).toBe('drop\\qzero')
  })

  it('reads back every exported field value that Vaultage itself wrote', () => {
    const values = [
      'p$ssw0rd',
      'postgres://user:p$ss@db.example.com:5432/app',
      '`backtick`',
      '$HOME',
      '${NOT_EXPANDED}',
      'plain-token',
      'has space',
      'has"double"quotes',
      "has'single'quotes",
      'back\\slash',
      'trailing\\',
      'line1\nline2',
      'crlf\r\n',
      'tab\there',
      '#hash',
      'value # not-a-comment',
      '',
      'unicode-é-😀',
    ]
    const entries = values.map((value, index) => ({ envKey: `FIELD_${index}`, value }))

    const parsed = parseDotenvAssignments(serializeEnvFile(entries))

    expect(parsed.map(assignment => assignment.value)).toEqual(values)
  })

  it('classifies test-local dotenv files as testing and contains manual files', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-project-scan-'))
    const outside = await mkdtemp(join(tmpdir(), 'vaultage-project-outside-'))
    try {
      const envFile = join(tempRoot, '.env.test.local')
      const latestFile = join(tempRoot, '.env.latest.local')
      await writeFile(envFile, 'TOKEN="abc # value"\n')
      await writeFile(latestFile, 'LOCAL_TOKEN=value\n')
      await writeFile(join(outside, 'outside.env'), 'OUTSIDE=value\n')

      const result = await scanProject({ path: tempRoot, manualFiles: [envFile] })
      expect(result.envFiles.find(file => file.path.endsWith('.env.test.local'))?.environment).toBe('testing')
      expect(result.envFiles.find(file => file.path.endsWith('.env.latest.local'))?.environment).toBe('development')
      expect(result.envKeys.find(key => key.key === 'TOKEN')?.values[0]?.value).toBe('abc # value')
      await expect(scanProject({
        path: tempRoot,
        manualFiles: [join(outside, 'outside.env')],
      })).rejects.toThrow('contained')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects symbolic-link roots and manual files', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vaultage-project-symlink-'))
    const target = join(tempRoot, 'target.env')
    const fileLink = join(tempRoot, 'linked.env')
    const rootLink = `${tempRoot}-link`
    await writeFile(target, 'TOKEN=value\n')
    await symlink(target, fileLink)
    await symlink(tempRoot, rootLink)
    try {
      await expect(scanProject({ path: tempRoot, manualFiles: [fileLink] })).rejects.toThrow('regular file')
      await expect(scanProject({ path: rootLink })).rejects.toThrow('regular folder')
    } finally {
      await rm(rootLink, { force: true })
    }
  })
})
