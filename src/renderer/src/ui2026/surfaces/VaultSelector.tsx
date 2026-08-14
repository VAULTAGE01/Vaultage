import { useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { VaultCollectionSnapshot } from '../../../../shared/vaultIpcContracts'
import { useTextInputDialog } from '../../components/TextInputDialogProvider'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { useVault } from '../../vaultContext'
import {
  VaultSelectorList,
  type ActiveVaultRootInteraction,
  type VaultEntry,
} from './VaultSelectorList'

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not update vaults'
}

export function nextUnnamedVaultName(vaultNames: readonly string[]): string {
  const existing = new Set(vaultNames)
  let sequence = 1
  while (existing.has(`Unnamed Vault ${String(sequence).padStart(2, '0')}`)) sequence += 1
  return `Unnamed Vault ${String(sequence).padStart(2, '0')}`
}

export function VaultSelector({
  activeContent,
  activeVaultRoot,
}: {
  readonly activeContent?: ReactNode
  readonly activeVaultRoot?: ActiveVaultRootInteraction
}): ReactElement {
  const requestTextInput = useTextInputDialog()
  const {
    state,
    listVaults,
    createVault,
    switchVault,
    renameVault,
    setVaultArchived,
    deleteVault,
  } = useVault()
  const [pendingVaultId, setPendingVaultId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VaultEntry | null>(null)
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const operationPendingRef = useRef(false)
  const activeVaultId = state.vault?.root.id

  useEffect(() => {
    let current = true
    void listVaults()
      .catch(error => {
        if (current) toast.error(messageFromError(error))
      })
    return () => { current = false }
  }, [activeVaultId, listVaults])

  const run = async (
    vaultId: string,
    operation: () => Promise<VaultCollectionSnapshot>,
  ): Promise<boolean> => {
    if (operationPendingRef.current) return false
    operationPendingRef.current = true
    setPendingVaultId(vaultId)
    try {
      await operation()
      return true
    } catch (error) {
      toast.error(messageFromError(error))
      return false
    } finally {
      operationPendingRef.current = false
      setPendingVaultId(null)
    }
  }

  const handleCreate = async (): Promise<void> => {
    const suggestedName = nextUnnamedVaultName(
      state.vaultCollection?.vaults.map(vault => vault.name) ?? [],
    )
    const name = await requestTextInput({
      title: 'New vault',
      description: 'Create another encrypted local vault.',
      label: 'Vault name',
      confirmLabel: 'Create vault',
      placeholder: suggestedName,
      initialValue: suggestedName,
      validation: { kind: 'non-empty' },
    })
    const trimmedName = name?.trim()
    if (!trimmedName) return
    await run('create', () => createVault(trimmedName))
  }

  const handleRename = async (vault: VaultEntry): Promise<void> => {
    const name = await requestTextInput({
      title: 'Rename vault',
      description: 'Choose a local name for this vault.',
      label: 'Vault name',
      confirmLabel: 'Rename vault',
      initialValue: vault.name,
      validation: { kind: 'non-empty' },
    })
    const trimmedName = name?.trim()
    if (!trimmedName || trimmedName === vault.name) return
    await run(vault.id, () => renameVault(vault.id, trimmedName))
  }

  const closeDelete = (): void => {
    if (pendingVaultId) return
    setDeleteTarget(null)
    setDeletionConfirmation('')
    setMasterPassword('')
  }

  const handleDelete = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!deleteTarget) return
    const expectedConfirmation = `DELETE ${deleteTarget.id}`
    if (deletionConfirmation !== expectedConfirmation || !masterPassword) return
    const didDelete = await run(deleteTarget.id, () => deleteVault(
      deleteTarget.id,
      deletionConfirmation,
      masterPassword,
    ))
    if (didDelete) closeDelete()
  }

  const expectedDeletionConfirmation = deleteTarget ? `DELETE ${deleteTarget.id}` : ''

  return (
    <>
      <VaultSelectorList
        collection={state.vaultCollection}
        pendingVaultId={pendingVaultId}
        activeContent={activeContent}
        activeVaultRoot={activeVaultRoot}
        onCreate={() => { void handleCreate() }}
        onSwitch={vaultId => { void run(vaultId, () => switchVault(vaultId)) }}
        onRename={vault => { void handleRename(vault) }}
        onSetArchived={(vault, archived) => {
          void run(vault.id, () => setVaultArchived(vault.id, archived))
        }}
        onDelete={vault => setDeleteTarget(vault)}
      />
      <Dialog open={deleteTarget !== null} onOpenChange={open => { if (!open) closeDelete() }}>
        {deleteTarget ? (
          <DialogContent className='max-w-2xl' aria-describedby='vault-delete-description'>
            <form onSubmit={event => { void handleDelete(event) }}>
              <DialogHeader>
                <DialogTitle>Delete vault</DialogTitle>
                <DialogDescription id='vault-delete-description'>
                  This permanently removes the archived vault and its encrypted local records.
                </DialogDescription>
              </DialogHeader>
              <div className='space-y-4 px-6 py-5'>
                <div className='space-y-2'>
                  <Label htmlFor='vault-delete-confirmation'>Confirmation</Label>
                  <Input
                    id='vault-delete-confirmation'
                    autoComplete='off'
                    spellCheck={false}
                    value={deletionConfirmation}
                    placeholder={expectedDeletionConfirmation}
                    onChange={event => setDeletionConfirmation(event.target.value)}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='vault-delete-password'>Master password</Label>
                  <Input
                    id='vault-delete-password'
                    type='password'
                    autoComplete='current-password'
                    value={masterPassword}
                    onChange={event => setMasterPassword(event.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type='button' variant='outline' disabled={pendingVaultId !== null} onClick={closeDelete}>
                  Cancel
                </Button>
                <Button
                  type='submit'
                  variant='destructive'
                  disabled={pendingVaultId !== null
                    || deletionConfirmation !== expectedDeletionConfirmation
                    || !masterPassword}
                >
                  Delete vault
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}
