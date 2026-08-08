import { useState, type ElementType, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Download,
  Eye,
  FileKey2,
  FileUp,
  History,
  KeyRound,
  Keyboard,
  LockKeyhole,
} from 'lucide-react'
import { useVault } from '../vaultContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRecoveryKit } from './RecoveryKitCenter'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenImport: () => void
  onOpenExport: () => void
  onOpenAudit: () => void
  onOpenShortcuts: () => void
  onOpenChangePassword: () => void
}

export default function CommunitySettingsModal({
  open,
  onOpenChange,
  onOpenImport,
  onOpenExport,
  onOpenAudit,
  onOpenShortcuts,
  onOpenChangePassword,
}: Props) {
  const { openRecoveryKit } = useRecoveryKit()
  const { state, setRevealPin, clearRevealPin, signOut } = useVault()
  const [pin, setPin] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const revealPinEnabled = state.vault?.preferences?.quickRevealPinEnabled === true

  const closeAndRun = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const savePin = async () => {
    if (!/^\d{6}$/u.test(pin) || !masterPassword) return
    setSavingPin(true)
    setPinError(null)
    try {
      const result = await setRevealPin(pin, masterPassword)
      if (!result.success) throw new Error(result.error ?? 'Could not save reveal PIN')
      setPin('')
      setMasterPassword('')
      toast.success(revealPinEnabled ? 'Reveal PIN replaced' : 'Reveal PIN enabled')
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'Could not save reveal PIN')
    } finally {
      setSavingPin(false)
    }
  }

  const removePin = async () => {
    if (!masterPassword) return
    setSavingPin(true)
    setPinError(null)
    try {
      const result = await clearRevealPin(masterPassword)
      if (!result.success) throw new Error(result.error ?? 'Could not remove reveal PIN')
      setPin('')
      setMasterPassword('')
      toast.success('Reveal PIN removed')
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'Could not remove reveal PIN')
    } finally {
      setSavingPin(false)
    }
  }

  const quitAndRequirePassword = async () => {
    const confirmed = window.confirm(
      'Quit Vaultage and require your master password next time? Touch ID unlock will be restored after you enter the master password.',
    )
    if (!confirmed) return
    onOpenChange(false)
    try {
      await signOut()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-3rem))] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>Vault Settings</DialogTitle>
          <DialogDescription>Local security, transfer, audit, and keyboard controls.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <SettingsGroup title="Vault">
            <SettingsAction icon={FileUp} title="Import secrets" detail="Import CSV or encrypted Vaultage data." onClick={() => closeAndRun(onOpenImport)} />
            <SettingsAction icon={Download} title="Export or back up" detail="Create an encrypted backup or confirmed plaintext export." onClick={() => closeAndRun(onOpenExport)} />
            <SettingsAction icon={History} title="Audit log" detail="Review and export local hash-chained activity." onClick={() => closeAndRun(onOpenAudit)} />
            <SettingsAction icon={Keyboard} title="Keyboard shortcuts" detail="Review the current Vault and Projects shortcuts." onClick={() => closeAndRun(onOpenShortcuts)} />
          </SettingsGroup>

          <SettingsGroup title="Security">
            <SettingsAction icon={KeyRound} title="Change master password" detail="Rotate the password that unwraps this vault." onClick={() => closeAndRun(onOpenChangePassword)} />
            <SettingsAction icon={FileKey2} title="Emergency Kit" detail="Create, verify, replace, or remove offline recovery for this vault." onClick={() => closeAndRun(openRecoveryKit)} />
            <div className="px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text">6-digit reveal PIN</p>
                  <p className="mt-0.5 text-xs text-muted">Quick reveal for pinned secrets after the vault is unlocked.</p>
                </div>
                <span className="rounded-full border border-border px-2 py-1 text-[10px] text-text-secondary">
                  {revealPinEnabled ? 'Enabled' : 'Off'}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr]">
                <Input
                  aria-label="Reveal PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={event => {
                    setPin(event.target.value.replace(/\D/gu, '').slice(0, 6))
                    setPinError(null)
                  }}
                  placeholder="000000"
                  className="font-mono"
                />
                <Input
                  aria-label="Master password for reveal PIN"
                  data-secure-input="true"
                  type="password"
                  value={masterPassword}
                  onChange={event => {
                    setMasterPassword(event.target.value)
                    setPinError(null)
                  }}
                  placeholder="Master password"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={savingPin || pin.length !== 6 || !masterPassword} onClick={() => { void savePin() }}>
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  {revealPinEnabled ? 'Replace PIN' : 'Create PIN'}
                </Button>
                <Button variant="outline" size="sm" disabled={savingPin || !revealPinEnabled || !masterPassword} onClick={() => { void removePin() }}>
                  Remove PIN
                </Button>
              </div>
              {pinError && <p className="mt-2 text-xs text-danger">{pinError}</p>}
            </div>
            <SettingsAction
              icon={LockKeyhole}
              title="Quit and require master password"
              detail="Forget Touch ID unlock until the next successful password unlock."
              danger
              onClick={() => { void quitAndRequirePassword() }}
            />
          </SettingsGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface/60">{children}</div>
    </section>
  )
}

function SettingsAction({
  icon: Icon,
  title,
  detail,
  danger = false,
  onClick,
}: {
  icon: ElementType
  title: string
  detail: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
    >
      <Icon className={danger ? 'h-4 w-4 text-danger' : 'h-4 w-4 text-accent'} />
      <span>
        <span className={danger ? 'block text-sm font-medium text-danger' : 'block text-sm font-medium text-text'}>{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{detail}</span>
      </span>
    </button>
  )
}
