import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function digestAppBundle(app) {
  const root = resolve(app)
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('app bundle must be a real directory')
  }
  const hash = createHash('sha256')
  hash.update('vaultage-app-bundle-tree-v1\0')
  walk(root, root, hash)
  return hash.digest('hex')
}

function walk(root, directory, hash) {
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name)
    const relativePath = relative(root, path).split(sep).join('/')
    if (!relativePath || relativePath.startsWith('../')) {
      throw new Error('app bundle traversal escaped its root')
    }
    const stat = lstatSync(path)
    const mode = (stat.mode & 0o777).toString(8)
    if (stat.isDirectory()) {
      hash.update(`directory\0${relativePath}\0${mode}\0`)
      walk(root, path, hash)
    } else if (stat.isFile()) {
      hash.update(`file\0${relativePath}\0${mode}\0${stat.size}\0`)
      hash.update(readFileSync(path))
      hash.update('\0')
    } else if (stat.isSymbolicLink()) {
      const target = readlinkSync(path)
      if (target.startsWith('/') || target.split('/').includes('..')) {
        throw new Error(`unsafe app bundle symlink: ${relativePath}`)
      }
      hash.update(`symlink\0${relativePath}\0${mode}\0${target}\0`)
    } else {
      throw new Error(`unsupported app bundle entry: ${relativePath}`)
    }
  }
}
