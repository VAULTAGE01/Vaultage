import { FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EnvProject } from '../types'
import { PinTargetButton } from './PinSecretButton'

type Props = {
  project: EnvProject
  selected: boolean
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
}

export default function CommunityProjectRow({
  project,
  selected,
  pinned,
  onOpen,
  onTogglePin,
}: Props) {
  const readyCount = project.entries.filter(entry => entry.envKey && entry.secretId && entry.fieldKey).length
  const pathLabel = project.path ? project.path.split('/').slice(-2).join('/') : 'No folder linked'

  return (
    <div
      className={cn(
        'flex w-full items-start gap-1 rounded-md px-2 py-2 text-left transition-colors',
        selected ? 'bg-accent/10 text-text' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text',
      )}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{project.name}</span>
        </div>
        <p className="mt-1 truncate pl-5 text-[10px] text-muted">{pathLabel}</p>
        <p className="mt-0.5 pl-5 text-[10px] text-muted">
          {readyCount}/{project.entries.length} mapped key{project.entries.length === 1 ? '' : 's'}
        </p>
      </button>
      <PinTargetButton
        compact
        pinned={pinned}
        targetLabel="Project"
        onClick={event => {
          event.stopPropagation()
          onTogglePin()
        }}
      />
    </div>
  )
}
