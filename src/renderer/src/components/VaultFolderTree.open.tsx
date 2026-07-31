import { useState } from 'react'
import { FileKey2, Folder, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { orderedFolderItems, type VaultTreeMoveTarget } from '../vaultContext'
import type { VaultFolder, VaultSecret, VaultTreeItemRef } from '../types'

type Props = {
  root: VaultFolder
  selectedFolderId: string | null
  selectedSecretId: string | null
  onOpenFolder: (id: string) => void
  onOpenSecret: (id: string) => void
  onMoveItem: (item: VaultTreeItemRef, target: VaultTreeMoveTarget) => Promise<void>
}

export default function VaultFolderTree({
  root,
  selectedFolderId,
  selectedSecretId,
  onOpenFolder,
  onOpenSecret,
  onMoveItem,
}: Props) {
  const [draggedItem, setDraggedItem] = useState<VaultTreeItemRef | null>(null)
  const [activeDropFolderId, setActiveDropFolderId] = useState<string | null>(null)

  const endDrag = () => {
    setDraggedItem(null)
    setActiveDropFolderId(null)
  }

  const dropItem = async (target: VaultTreeMoveTarget) => {
    if (!draggedItem) return
    try {
      await onMoveItem(draggedItem, target)
    } finally {
      endDrag()
    }
  }

  return (
    <FolderNode
      folder={root}
      depth={0}
      selectedFolderId={selectedFolderId}
      selectedSecretId={selectedSecretId}
      draggedItem={draggedItem}
      activeDropFolderId={activeDropFolderId}
      onOpenFolder={onOpenFolder}
      onOpenSecret={onOpenSecret}
      onDragItem={setDraggedItem}
      onDragEnd={endDrag}
      onDropFolderHover={setActiveDropFolderId}
      onDropItem={target => { void dropItem(target) }}
    />
  )
}

type TreeInteractionProps = {
  selectedFolderId: string | null
  selectedSecretId: string | null
  draggedItem: VaultTreeItemRef | null
  activeDropFolderId: string | null
  onOpenFolder: (id: string) => void
  onOpenSecret: (id: string) => void
  onDragItem: (item: VaultTreeItemRef) => void
  onDragEnd: () => void
  onDropFolderHover: (folderId: string | null) => void
  onDropItem: (target: VaultTreeMoveTarget) => void
}

function FolderNode({
  folder,
  depth,
  ...interaction
}: TreeInteractionProps & { folder: VaultFolder; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  const ordered = orderedFolderItems(folder)
  const secrets = new Map(folder.secrets.map(secret => [secret.id, secret]))
  const folders = new Map(folder.children.map(child => [child.id, child]))
  const hasChildren = ordered.length > 0
  const canAcceptDrop = interaction.draggedItem?.kind === 'secret'
  const dropInside = interaction.activeDropFolderId === folder.id

  return (
    <div>
      <button
        type="button"
        aria-expanded={hasChildren ? open : undefined}
        onDragEnter={event => {
          if (!canAcceptDrop) return
          event.preventDefault()
          interaction.onDropFolderHover(folder.id)
          if (hasChildren) setOpen(true)
        }}
        onDragOver={event => {
          if (!canAcceptDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          interaction.onDropFolderHover(folder.id)
        }}
        onDrop={event => {
          if (!canAcceptDrop) return
          event.preventDefault()
          event.stopPropagation()
          interaction.onDropItem({ folderId: folder.id, position: 'inside' })
        }}
        onClick={() => {
          interaction.onOpenFolder(folder.id)
          if (hasChildren) setOpen(value => !value)
        }}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
          interaction.selectedFolderId === folder.id
            ? 'bg-white/10 text-text'
            : 'text-text-secondary hover:bg-white/[0.06] hover:text-text',
          dropInside && 'bg-white/[0.08] ring-1 ring-white/[0.14]',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
          {hasChildren && (
            <svg
              className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-90')}
              fill="none"
              viewBox="0 0 12 12"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 2l4 4-4 4" />
            </svg>
          )}
        </span>
        <Folder className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="ml-auto flex-shrink-0 text-[10px] tabular-nums text-muted">{ordered.length}</span>
      </button>
      {open && (
        <div>
          {ordered.map(item => {
            if (item.kind === 'folder') {
              const child = folders.get(item.id)
              return child ? (
                <FolderNode
                  key={`folder:${child.id}`}
                  folder={child}
                  depth={depth + 1}
                  {...interaction}
                />
              ) : null
            }
            const secret = secrets.get(item.id)
            return secret ? (
              <SecretRow
                key={`secret:${secret.id}`}
                secret={secret}
                folderId={folder.id}
                depth={depth + 1}
                selected={interaction.selectedSecretId === secret.id}
                onOpen={() => interaction.onOpenSecret(secret.id)}
                draggedItem={interaction.draggedItem}
                onDragItem={interaction.onDragItem}
                onDragEnd={interaction.onDragEnd}
                onDropFolderHover={interaction.onDropFolderHover}
                onDropItem={interaction.onDropItem}
              />
            ) : null
          })}
        </div>
      )}
    </div>
  )
}

type SecretRowProps = {
  secret: VaultSecret
  folderId: string
  depth: number
  selected: boolean
  onOpen: () => void
  draggedItem: VaultTreeItemRef | null
  onDragItem: (item: VaultTreeItemRef) => void
  onDragEnd: () => void
  onDropFolderHover: (folderId: string | null) => void
  onDropItem: (target: VaultTreeMoveTarget) => void
}

function SecretRow({
  secret,
  folderId,
  depth,
  selected,
  onOpen,
  draggedItem,
  onDragItem,
  onDragEnd,
  onDropFolderHover,
  onDropItem,
}: SecretRowProps) {
  const canAcceptDrop = draggedItem?.kind === 'secret' && draggedItem.id !== secret.id

  return (
    <button
      type="button"
      draggable
      title={`Open ${secret.name}, or drag to move it to another folder`}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-vaultage-secret', secret.id)
        onDragItem({ kind: 'secret', id: secret.id })
      }}
      onDragEnd={onDragEnd}
      onDragOver={event => {
        if (!canAcceptDrop) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDropFolderHover(folderId)
      }}
      onDrop={event => {
        if (!canAcceptDrop) return
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDropItem({ folderId, position, target: { kind: 'secret', id: secret.id } })
      }}
      onClick={onOpen}
      className={cn(
        'flex h-8 w-full cursor-grab items-center gap-2 rounded-md px-2 text-left text-xs transition-colors active:cursor-grabbing',
        selected ? 'bg-accent/10 text-text' : 'text-muted hover:bg-white/[0.06] hover:text-text',
        draggedItem?.kind === 'secret' && draggedItem.id === secret.id && 'opacity-50',
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <FileKey2 className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0 flex-1 truncate">{secret.name}</span>
      <GripVertical aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted/70" />
    </button>
  )
}
