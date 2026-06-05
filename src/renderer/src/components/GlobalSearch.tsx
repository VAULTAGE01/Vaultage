import { useMemo } from 'react'
import { useVault, flatSecrets } from '../vaultContext'
import { SECRET_TYPE_LABELS } from '../types'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'

interface Props {
  onClose: () => void
  onPick?: () => void
}

const TYPE_COLOR: Record<string, string> = {
  password:   'rgba(59,130,246,0.15)',
  apiKey:     'rgba(168,85,247,0.15)',
  sshKey:     'rgba(0,255,127,0.12)',
  secureNote: 'rgba(234,179,8,0.12)',
  custom:     'rgba(255,255,255,0.06)',
  image:      'rgba(236,72,153,0.12)',
}
const TYPE_DOT: Record<string, string> = {
  password:   '#3b82f6',
  apiKey:     '#a855f7',
  sshKey:     '#00FF7F',
  secureNote: '#eab308',
  custom:     '#6b7280',
  image:      '#ec4899',
}

export default function GlobalSearch({ onClose, onPick }: Props) {
  const { state, selectFolder, selectSecret } = useVault()

  const all = useMemo(
    () => state.vault ? flatSecrets(state.vault.root) : [],
    [state.vault],
  )

  // Group results by folder for CommandGroup
  const folderGroups = useMemo(() => {
    const map = new Map<string, { folderPath: string; items: typeof all }>()
    for (const item of all) {
      if (!map.has(item.folderId)) {
        map.set(item.folderId, { folderPath: item.folderPath, items: [] })
      }
      map.get(item.folderId)!.items.push(item)
    }
    return Array.from(map.values())
  }, [all])

  const pick = (folderId: string, secretId: string) => {
    onPick?.()
    selectFolder(folderId)
    selectSecret(secretId)
    onClose()
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent hideClose className="p-0 max-w-lg overflow-hidden gap-0 no-drag">
        <Command
          filter={(value, search) => {
            if (!search.trim()) return 1
            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }}
        >
          <CommandInput placeholder="Search secrets…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {folderGroups.map(({ folderPath, items }) => (
              <CommandGroup key={folderPath} heading={folderPath}>
                {items.map(({ secret, folderId }) => (
                  <CommandItem
                    key={secret.id}
                    value={[secret.name, secret.tags?.join(' '), secret.description, secret.scope].filter(Boolean).join(' ')}
                    onSelect={() => pick(folderId, secret.id)}
                    className="gap-3"
                  >
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: TYPE_COLOR[secret.type] ?? 'rgba(255,255,255,0.06)' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: TYPE_DOT[secret.type] ?? '#6b7280' }}
                      />
                    </div>
                    <span className="flex-1 truncate">{secret.name}</span>
                    <span
                      className="text-[10px] flex-shrink-0 px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.05)', color: '#5a5a5a' }}
                    >
                      {SECRET_TYPE_LABELS[secret.type]}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          {/* Hint bar */}
          <div
            className="flex items-center gap-4 px-4 py-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            {[['↑↓', 'navigate'], ['↵', 'open'], ['esc', 'close']].map(([key, label]) => (
              <span key={key} className="flex items-center gap-1.5">
                <kbd
                  className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#757575' }}
                >
                  {key}
                </kbd>
                <span className="text-[10px]" style={{ color: '#5a5a5a' }}>{label}</span>
              </span>
            ))}
            <span className="ml-auto text-[10px] font-medium" style={{ color: '#00FF7F', opacity: 0.7 }}>
              ⌘K
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
