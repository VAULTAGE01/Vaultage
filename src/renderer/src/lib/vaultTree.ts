import type { VaultFolder, VaultSecret, VaultTreeItemRef } from '../types'

export type FlatSecretItem = { secret: VaultSecret; folderId: string; folderPath: string }

export function flatSecrets(
  node: VaultFolder,
  path: string[] = [],
): FlatSecretItem[] {
  const crumb = [...path, node.name]
  return [
    ...node.secrets.map(secret => ({ secret, folderId: node.id, folderPath: crumb.join(' › ') })),
    ...node.children.flatMap(child => flatSecrets(child, crumb)),
  ]
}

export function findFolder(node: VaultFolder, id: string): VaultFolder | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const folder = findFolder(child, id)
    if (folder) return folder
  }
  return null
}

export function findSecret(node: VaultFolder, id: string): { secret: VaultSecret; folderId: string } | null {
  for (const secret of node.secrets) {
    if (secret.id === id) return { secret, folderId: node.id }
  }
  for (const child of node.children) {
    const found = findSecret(child, id)
    if (found) return found
  }
  return null
}

export function orderedFolderItems(folder: VaultFolder): VaultTreeItemRef[] {
  const children = new Set(folder.children.map(child => child.id))
  const secrets = new Set(folder.secrets.map(secret => secret.id))
  const seen = new Set<string>()
  const items: VaultTreeItemRef[] = []

  for (const item of folder.itemOrder ?? []) {
    if (item.kind !== 'folder' && item.kind !== 'secret') continue
    const exists = item.kind === 'folder' ? children.has(item.id) : secrets.has(item.id)
    const key = `${item.kind}:${item.id}`
    if (!exists || seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }

  for (const secret of folder.secrets) {
    const key = `secret:${secret.id}`
    if (!seen.has(key)) items.push({ kind: 'secret', id: secret.id })
  }
  for (const child of folder.children) {
    const key = `folder:${child.id}`
    if (!seen.has(key)) items.push({ kind: 'folder', id: child.id })
  }

  return items
}
