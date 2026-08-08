import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  CheckCircle2,
  Download,
  FileKey2,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AuthRecoveryKitMaterial,
  AuthRecoveryKitMetadata,
} from '../../../shared/authIpcContracts'
import { AUTH_RECOVERY_PDF_SAVE_FAILED_MESSAGE } from '../../../shared/authIpcContracts'
import { useVault } from '../vaultContext'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type RecoveryKitContextValue = { openRecoveryKit: () => void }
type View = 'status' | 'password' | 'material' | 'revoke'

const RecoveryKitContext = createContext<RecoveryKitContextValue | null>(null)

export function RecoveryKitProvider({ children }: { children: ReactNode }) {
  const { state, clearPendingRecoveryKit } = useVault()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('status')
  const [status, setStatus] = useState<AuthRecoveryKitMetadata | null>(null)
  const [material, setMaterial] = useState<AuthRecoveryKitMaterial | null>(null)
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [revocationPhrase, setRevocationPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfSaved, setPdfSaved] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async (): Promise<AuthRecoveryKitMetadata | null> => {
    const result = await window.vault.recoveryStatus()
    if (!result.success) throw new Error(result.error ?? 'Could not inspect Emergency Kit status')
    const metadata = result.data?.configured ? result.data.metadata ?? null : null
    setStatus(metadata)
    return metadata
  }, [])

  useEffect(() => {
    if (!state.pendingRecoveryKit) return
    setMaterial(state.pendingRecoveryKit)
    setStatus(state.pendingRecoveryKit)
    setView('material')
    setPdfSaved(false)
    setAcknowledged(false)
    setVerificationCode('')
    setError(null)
    setOpen(true)
  }, [state.pendingRecoveryKit])

  const openRecoveryKit = useCallback(() => {
    setMaterial(null)
    setPassword('')
    setVerificationCode('')
    setRevocationPhrase('')
    setPdfSaved(false)
    setAcknowledged(false)
    setError(null)
    setView('status')
    setOpen(true)
    void refreshStatus().catch(reason => setError(message(reason)))
  }, [refreshStatus])

  const close = () => {
    if (state.pendingRecoveryKit && !acknowledged) return
    if (state.pendingRecoveryKit) {
      clearPendingRecoveryKit()
      setMaterial(null)
    }
    setOpen(false)
    setError(null)
  }

  const generate = async () => {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.vault.createRecoveryKit({ currentPassword: password })
      if (!result.success || !isRecoveryMaterial(result.data)) {
        throw new Error(result.error ?? 'Could not create the Emergency Kit')
      }
      setMaterial(result.data)
      setStatus(result.data)
      setPassword('')
      setPdfSaved(false)
      setAcknowledged(false)
      setVerificationCode('')
      setView('material')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  const savePdf = async () => {
    if (!material || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.vault.saveRecoveryKitPdf({ recoveryCode: material.recoveryCode })
      if (result.cancelled) return
      if (!result.success) {
        setError(AUTH_RECOVERY_PDF_SAVE_FAILED_MESSAGE)
        return
      }
      setPdfSaved(true)
      toast.success('Emergency Kit PDF saved')
    } catch {
      setError(AUTH_RECOVERY_PDF_SAVE_FAILED_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!verificationCode || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.vault.verifyRecoveryKit({ recoveryCode: verificationCode })
      if (!result.success) throw new Error(result.error ?? 'Emergency Kit verification failed')
      setVerificationCode('')
      if (isRecoveryMetadata(result.data)) setStatus(result.data)
      setView('status')
      toast.success('Emergency Kit verified')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  const finishMaterial = () => {
    if (!acknowledged) return
    clearPendingRecoveryKit()
    setMaterial(null)
    setOpen(false)
    void refreshStatus().catch(() => undefined)
  }

  const revoke = async () => {
    if (!password || revocationPhrase !== 'REMOVE KIT' || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.vault.revokeRecoveryKit({ currentPassword: password })
      if (!result.success) throw new Error(result.error ?? 'Could not remove the Emergency Kit')
      setStatus(null)
      setMaterial(null)
      setPassword('')
      setRevocationPhrase('')
      setView('status')
      toast.success('Emergency Kit removed from this vault')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  const value = useMemo(() => ({ openRecoveryKit }), [openRecoveryKit])
  const required = Boolean(state.pendingRecoveryKit)

  return (
    <RecoveryKitContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={next => { if (!next) close() }}>
        <DialogContent
          className="w-[min(760px,calc(100vw-24px))] max-w-none overflow-hidden border-border bg-bg/95 p-0 shadow-2xl backdrop-blur-2xl"
          onEscapeKeyDown={event => { if (required && !acknowledged) event.preventDefault() }}
          onPointerDownOutside={event => { if (required && !acknowledged) event.preventDefault() }}
        >
          <DialogHeader className="border-b border-border px-5 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                <FileKey2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle>Vaultage Emergency Kit</DialogTitle>
                <DialogDescription className="mt-1">
                  Offline recovery for this local vault. Vaultage never receives a copy.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-5 py-5 sm:px-7">
            {view === 'status' && (
              <StatusView
                status={status}
                onCreate={() => { setPassword(''); setView('password'); setError(null) }}
                onReplace={() => { setPassword(''); setView('password'); setError(null) }}
                onVerify={() => { setMaterial(null); setVerificationCode(''); setView('material'); setError(null) }}
                onRevoke={() => { setPassword(''); setRevocationPhrase(''); setView('revoke'); setError(null) }}
              />
            )}

            {view === 'password' && (
              <div className="mx-auto max-w-xl space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-text">
                    {status ? 'Replace the current kit' : 'Create an Emergency Kit'}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Confirm the current master password. Replacing the kit revokes the prior code on this active vault.
                  </p>
                </div>
                <div>
                  <Label htmlFor="recovery-current-password">Current master password</Label>
                  <Input
                    autoFocus
                    className="mt-1.5"
                    data-secure-input="true"
                    id="recovery-current-password"
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') void generate() }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setView('status')} disabled={busy}>Back</Button>
                  <Button onClick={() => { void generate() }} disabled={!password || busy}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {busy ? 'Creating…' : status ? 'Replace kit' : 'Create kit'}
                  </Button>
                </div>
              </div>
            )}

            {view === 'material' && material && (
              <RecoveryKitMaterialStep
                acknowledged={acknowledged}
                busy={busy}
                material={material}
                onAcknowledgementChange={setAcknowledged}
                onContinue={finishMaterial}
                onSavePdf={() => { void savePdf() }}
                pdfSaved={pdfSaved}
              />
            )}

            {view === 'material' && !material && (
              <div className="mx-auto max-w-xl space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-text">Verify an existing kit</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">Enter the code from your stored PDF. Vaultage checks it locally against this open vault.</p>
                </div>
                <Input
                  autoFocus
                  className="font-mono text-xs"
                  data-secure-input="true"
                  placeholder="VLT1-…"
                  value={verificationCode}
                  onChange={event => setVerificationCode(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') void verify() }}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setView('status')} disabled={busy}>Back</Button>
                  <Button onClick={() => { void verify() }} disabled={!verificationCode || busy}>
                    {busy ? 'Verifying…' : 'Verify kit'}
                  </Button>
                </div>
              </div>
            )}

            {view === 'revoke' && (
              <div className="mx-auto max-w-xl space-y-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    Removing the kit leaves the master password and local unlock methods as the only ways into this vault. Existing offline backups may still contain older recovery envelopes.
                  </AlertDescription>
                </Alert>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="revoke-kit-password">Current master password</Label>
                    <Input id="revoke-kit-password" className="mt-1.5" data-secure-input="true" type="password" value={password} onChange={event => setPassword(event.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="revoke-kit-confirmation">Type REMOVE KIT</Label>
                    <Input id="revoke-kit-confirmation" className="mt-1.5 font-mono" value={revocationPhrase} onChange={event => setRevocationPhrase(event.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setView('status')} disabled={busy}>Back</Button>
                  <Button variant="destructive" onClick={() => { void revoke() }} disabled={!password || revocationPhrase !== 'REMOVE KIT' || busy}>
                    <Trash2 className="mr-2 h-4 w-4" />Remove kit
                  </Button>
                </div>
              </div>
            )}

            {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}
          </div>
        </DialogContent>
      </Dialog>
    </RecoveryKitContext.Provider>
  )
}

export function canContinueInitialRecoveryKit(acknowledged: boolean, busy: boolean): boolean {
  return acknowledged && !busy
}

export function RecoveryKitMaterialStep({
  acknowledged,
  busy,
  material,
  onAcknowledgementChange,
  onContinue,
  onSavePdf,
  pdfSaved,
}: {
  acknowledged: boolean
  busy: boolean
  material: AuthRecoveryKitMaterial
  onAcknowledgementChange: (acknowledged: boolean) => void
  onContinue: () => void
  onSavePdf: () => void
  pdfSaved: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border bg-surface/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Recovery code</p>
            <span className="font-mono text-[10px] text-muted">{material.vaultFingerprint}</span>
          </div>
          <p className="mt-4 select-none break-words font-mono text-base font-semibold leading-8 tracking-[0.12em] text-text sm:text-lg">
            {material.recoveryCode}
          </p>
          <Button className="mt-4 w-full" variant={pdfSaved ? 'outline' : 'default'} onClick={onSavePdf} disabled={busy}>
            {pdfSaved ? <CheckCircle2 className="mr-2 h-4 w-4 text-accent" /> : <Download className="mr-2 h-4 w-4" />}
            {pdfSaved ? 'PDF saved' : 'Save private PDF'}
          </Button>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-surface/40 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-accent" />
            <div>
              <p className="text-sm font-medium text-text">Store this code safely</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Keep the code or optional PDF somewhere you control, away from this Mac. Vaultage cannot recreate it for you.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-bg/45 p-3">
            <Checkbox
              aria-label="I saved this recovery code somewhere safe and understand Vaultage cannot recreate it."
              checked={acknowledged}
              id="recovery-kit-acknowledgement"
              onCheckedChange={checked => onAcknowledgementChange(checked === true)}
            />
            <Label className="cursor-pointer text-xs leading-relaxed text-text" htmlFor="recovery-kit-acknowledgement">
              I saved this recovery code somewhere safe and understand Vaultage cannot recreate it.
            </Label>
          </div>
        </div>
      </div>

      <Alert variant="warning">
        <AlertDescription>
          Anyone with the kit and your encrypted vault files can reset the master password. If every copy is lost, Vaultage and support cannot recreate it.
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted">The code is never uploaded, emailed, logged, or included in telemetry.</p>
        <Button onClick={onContinue} disabled={!canContinueInitialRecoveryKit(acknowledged, busy)}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function StatusView({
  status,
  onCreate,
  onReplace,
  onVerify,
  onRevoke,
}: {
  status: AuthRecoveryKitMetadata | null
  onCreate: () => void
  onReplace: () => void
  onVerify: () => void
  onRevoke: () => void
}) {
  if (!status) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-accent">
          <FileKey2 className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-text">No Emergency Kit is configured</h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
          Create an offline recovery path before the master password is ever lost. It wraps this vault key locally and does not involve your Vaultage account.
        </p>
        <Button className="mt-5" onClick={onCreate}>Create Emergency Kit</Button>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Status" value={status.verifiedAt ? 'Verified' : 'Not verified'} accent={Boolean(status.verifiedAt)} />
        <Metric label="Vault fingerprint" value={status.vaultFingerprint} mono />
        <Metric label="Created" value={new Date(status.createdAt).toLocaleDateString()} />
      </div>
      <Alert>
        <AlertDescription>
          {status.verifiedAt
            ? 'Vaultage stores only the encrypted recovery wrapper. The recovery code itself exists only in the copy you saved.'
            : 'This kit has not been verified. If you did not save its code, replace it now. You can verify any stored copy from this screen.'}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onVerify}><ShieldCheck className="mr-2 h-4 w-4" />Verify kit</Button>
        <Button variant="outline" onClick={onReplace}><RotateCcw className="mr-2 h-4 w-4" />Replace kit</Button>
        <Button variant="destructive" onClick={onRevoke}><Trash2 className="mr-2 h-4 w-4" />Remove kit</Button>
      </div>
    </div>
  )
}

function Metric({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`mt-1.5 text-xs font-medium ${mono ? 'font-mono' : ''} ${accent ? 'text-accent' : 'text-text'}`}>{value}</p>
    </div>
  )
}

function isRecoveryMaterial(value: unknown): value is AuthRecoveryKitMaterial {
  return isRecoveryMetadata(value)
    && typeof (value as { recoveryCode?: unknown }).recoveryCode === 'string'
}

function isRecoveryMetadata(value: unknown): value is AuthRecoveryKitMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.format === 'vaultage.recovery-kit.v1'
    && typeof record.generation === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.vaultFingerprint === 'string'
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function useRecoveryKit(): RecoveryKitContextValue {
  const context = useContext(RecoveryKitContext)
  if (!context) throw new Error('useRecoveryKit must be inside RecoveryKitProvider')
  return context
}
