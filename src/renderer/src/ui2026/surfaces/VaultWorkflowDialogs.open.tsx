import { useState, type ComponentType, type ReactElement } from 'react'
import { Folder, KeyRound, LockKeyhole, Upload } from 'lucide-react'
import { useVault } from '../../vaultContext'
import AddSecretModal from '../../components/AddSecretModal.open'
import ChangePasswordModal from '../../components/ChangePasswordModal'
import ExportModal from '../../components/ExportModal'
import ImportModal from '../../components/ImportModal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { VaultWorkflow } from './vaultSurfaceActions.open'

type VaultWorkflowDialogsProps = {
  readonly workflow: VaultWorkflow | null
  readonly onClose: () => void
  readonly addSecretModal?: ComponentType<{ readonly folderId: string, readonly onClose: () => void }>
}

export function VaultWorkflowDialogs({
  workflow,
  onClose,
  addSecretModal: AddSecretModalComponent = AddSecretModal,
}: VaultWorkflowDialogsProps): ReactElement | null {
  const { state, addFolder, lock } = useVault()
  const [transferStep, setTransferStep] = useState<'choose' | 'import' | 'export'>('choose')
  const [collectionName, setCollectionName] = useState('')
  const [savingCollection, setSavingCollection] = useState(false)
  const [settingsStep, setSettingsStep] = useState<'overview' | 'password'>('overview')

  const close = (): void => {
    setTransferStep('choose')
    setCollectionName('')
    setSettingsStep('overview')
    onClose()
  }
  const createCollection = async (): Promise<void> => {
    const name = collectionName.trim()
    const parentId = state.selectedFolderId ?? state.vault?.root.id
    if (!name || !parentId || savingCollection) return
    setSavingCollection(true)
    try {
      await addFolder(parentId, name)
      close()
    } finally {
      setSavingCollection(false)
    }
  }

  if (workflow === 'add-secret') {
    return <AddSecretModalComponent folderId={state.selectedFolderId ?? state.vault?.root.id ?? 'root'} onClose={close} />
  }
  if (workflow === 'import-export') {
    if (transferStep === 'import') return <ImportModal initialFolderId={state.vault?.root.id ?? 'root'} onClose={close} />
    if (transferStep === 'export') return <ExportModal onClose={close} />
    return (
      <Dialog open onOpenChange={open => { if (!open) close() }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Import or export</DialogTitle>
            <DialogDescription>Choose the transfer flow you want to open.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <Button type='button' variant='outline' className='h-auto justify-start gap-3 px-4 py-4 text-left' onClick={() => setTransferStep('import')}>
              <Upload size={18} aria-hidden />
              <span><strong className='block'>Import secrets</strong><span className='text-muted-foreground'>Bring in CSV, encrypted exports, browser exports, or images.</span></span>
            </Button>
            <Button type='button' variant='outline' className='h-auto justify-start gap-3 px-4 py-4 text-left' onClick={() => setTransferStep('export')}>
              <KeyRound size={18} aria-hidden />
              <span><strong className='block'>Export secrets</strong><span className='text-muted-foreground'>Create an encrypted backup, JSON, or CSV export.</span></span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
  if (workflow === 'new-collection') {
    return (
      <Dialog open onOpenChange={open => { if (!open) close() }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>Create a collection in the selected Vault location.</DialogDescription>
          </DialogHeader>
          <Input autoFocus aria-label='Collection name' value={collectionName} onChange={event => setCollectionName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createCollection() }} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={close}>Cancel</Button>
            <Button type='button' disabled={!collectionName.trim() || savingCollection} onClick={() => void createCollection()}><Folder size={16} aria-hidden />Create collection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
  if (workflow === 'settings') {
    if (settingsStep === 'password') return <ChangePasswordModal onClose={close} />
    return (
      <Dialog open onOpenChange={open => { if (!open) close() }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Vault settings</DialogTitle>
            <DialogDescription>Manage local Vault security controls.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Button type='button' variant='outline' className='justify-start gap-3' onClick={() => setSettingsStep('password')}><KeyRound size={18} aria-hidden />Change master password</Button>
            <Button type='button' variant='outline' className='justify-start gap-3' onClick={() => { void lock(); close() }}><LockKeyhole size={18} aria-hidden />Lock Vault</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
  return null
}
