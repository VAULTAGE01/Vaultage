import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCircle2,
  Compass,
  FileJson,
  FileSpreadsheet,
  Globe,
  Image as ImageIcon,
  LockKeyhole,
  Search,
  UploadCloud,
} from 'lucide-react'
import { useVault } from '../vaultContext'
import {
  MAX_CSV_IMPORT_BYTES,
  parseCsv,
  parseCsvTable,
  prepareBrowserRows,
  prepareRows,
  type BrowserImportSource,
  type PreparedSecret,
} from '../lib/csvImport'
import { parseVaultJson } from '../vaultFormat'
import type { VaultFolder, VaultRoot, VaultSecret } from '../types'
import { SECRET_TYPE_LABELS } from '../types'
import { ImportPreviewValue, IMPORT_VALUE_MASK } from './ImportPreviewValue'
import {
  ImportParseAttemptGate,
  MAX_IMAGE_IMPORT_SELECTION_COUNT,
  isCurrentImportDestination,
  readBoundedImageImportSelection,
} from '../lib/importFlowSecurity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function flatFolders(node: VaultFolder, path: string[] = []): { id: string; label: string }[] {
  const here = [...path, node.name]
  return [
    { id: node.id, label: here.join(' › ') },
    ...node.children.flatMap(c => flatFolders(c, here)),
  ]
}

function readImageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      if (typeof ev.target?.result === 'string') resolve(ev.target.result)
      else reject(new Error('Image read failed'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Image read failed'))
    reader.readAsDataURL(file)
  })
}

function imageName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim() || 'Imported image'
}

function jsonSecretRows(vault: VaultRoot): { prepared: PreparedSecret; secretId: string }[] {
  const rows: { prepared: PreparedSecret; secretId: string }[] = []

  function walk(folder: VaultFolder): void {
    for (const secret of folder.secrets) {
      const index = rows.length
      rows.push({
        secretId: secret.id,
        prepared: {
          index,
          raw: {
            name: secret.name,
            type: secret.type,
            value: previewSecretValue(secret),
          },
          secret: previewSecretDraft(secret),
          error: null,
        },
      })
    }
    for (const child of folder.children) walk(child)
  }

  walk(vault.root)
  return rows
}

function previewSecretDraft(secret: VaultSecret): PreparedSecret['secret'] {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = secret
  return draft
}

function previewSecretValue(secret: VaultSecret): string {
  if (secret.type === 'image') return 'image'
  return secret.fields.some(field => field.value.length > 0) || secret.notes
    ? IMPORT_VALUE_MASK
    : ''
}

function looksLikeEncryptedExport(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown
    return Boolean(
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).format === 'vaultage.encrypted-export.v1',
    )
  } catch {
    return false
  }
}

interface Props {
  initialFolderId?: string | null
  onClose: () => void
}

type Step = 'source' | 'input' | 'preview'
type ImportSource = 'chrome' | 'safari' | 'csv' | 'vaultageJson' | 'images'

const MAX_VAULTAGE_EXPORT_FILE_BYTES = 20 * 1024 * 1024

const SOURCE_SECTIONS: {
  title: string
  items: {
    id: ImportSource
    label: string
    description: string
    icon: typeof Globe
    iconClassName: string
  }[]
}[] = [
  {
    title: 'My browser',
    items: [
      { id: 'chrome', label: 'Chrome', description: 'Google Password Manager CSV', icon: Globe, iconClassName: 'text-emerald-300' },
      { id: 'safari', label: 'Safari', description: 'Safari Passwords.csv', icon: Compass, iconClassName: 'text-sky-300' },
    ],
  },
  {
    title: 'Somewhere else',
    items: [
      { id: 'csv', label: 'CSV file', description: 'Vaultage or spreadsheet CSV', icon: FileSpreadsheet, iconClassName: 'text-cyan-300' },
      { id: 'vaultageJson', label: 'Vaultage JSON', description: 'JSON or encrypted export', icon: FileJson, iconClassName: 'text-violet-300' },
      { id: 'images', label: 'Images', description: 'Screenshots, scans, or notes', icon: ImageIcon, iconClassName: 'text-pink-300' },
    ],
  },
]

export default function ImportModal({ initialFolderId, onClose }: Props) {
  const { state, addSecrets, importFolderTree, selectFolder, selectSecret } = useVault()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const jsonAttemptGateRef = useRef(new ImportParseAttemptGate())
  const currentJsonTextRef = useRef('')
  const sourceRef = useRef<ImportSource | null>(null)
  const fileReadAttemptRef = useRef(0)
  const imageReadAttemptRef = useRef(0)

  const [step,        setStep]        = useState<Step>('source')
  const [source,      setSource]      = useState<ImportSource | null>(null)
  const [query,       setQuery]       = useState('')
  const [text,        setText]        = useState('')
  const [jsonPassword, setJsonPassword] = useState('')
  const [jsonNeedsPassword, setJsonNeedsPassword] = useState(false)
  const [jsonImportRoot, setJsonImportRoot] = useState<VaultFolder | null>(null)
  const [jsonSecretIds, setJsonSecretIds] = useState<Record<number, string>>({})
  const encryptedImportTokenRef = useRef<string | null>(null)
  const [encryptedSelectionIds, setEncryptedSelectionIds] = useState<Record<number, string>>({})
  const [parsed,      setParsed]      = useState<PreparedSecret[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [included,    setIncluded]    = useState<Set<number>>(new Set())
  const [folderId,    setFolderId]    = useState<string | null>(
    initialFolderId ?? state.selectedFolderId ?? state.vault?.root.id ?? null,
  )
  const [importing,   setImporting]   = useState(false)
  const [doneCount,   setDoneCount]   = useState<number | null>(null)
  const latestVaultRef = useRef(state.vault)
  latestVaultRef.current = state.vault

  const folders = useMemo(
    () => state.vault ? flatFolders(state.vault.root) : [],
    [state.vault],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || importing) return
      jsonAttemptGateRef.current.invalidate()
      fileReadAttemptRef.current++
      imageReadAttemptRef.current++
      setJsonPassword('')
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, importing])

  useEffect(() => () => {
    jsonAttemptGateRef.current.invalidate()
    fileReadAttemptRef.current++
    imageReadAttemptRef.current++
    const token = encryptedImportTokenRef.current
    encryptedImportTokenRef.current = null
    if (token) void window.vault.cancelEncryptedImport({ token })
  }, [])

  useEffect(() => {
    if (folderId && state.vault && !isCurrentImportDestination(state.vault, folderId)) {
      setFolderId(null)
    }
  }, [folderId, state.vault])

  // ── Step: Input ─────────────────────────────────────────────────────────

  const selectedSource = SOURCE_SECTIONS.flatMap(s => s.items).find(item => item.id === source) ?? null
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SOURCE_SECTIONS
    return SOURCE_SECTIONS
      .map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        ),
      }))
      .filter(section => section.items.length > 0)
  }, [query])

  const chooseSource = (next: ImportSource) => {
    const token = encryptedImportTokenRef.current
    encryptedImportTokenRef.current = null
    if (token) void window.vault.cancelEncryptedImport({ token })
    jsonAttemptGateRef.current.invalidate()
    fileReadAttemptRef.current++
    imageReadAttemptRef.current++
    currentJsonTextRef.current = ''
    sourceRef.current = next
    setSource(next)
    setText('')
    setJsonPassword('')
    setJsonNeedsPassword(false)
    setJsonImportRoot(null)
    setJsonSecretIds({})
    setEncryptedSelectionIds({})
    setParsed([])
    setParseErrors([])
    setIncluded(new Set())
    setStep('input')
  }

  const replaceImportText = (next: string) => {
    const token = encryptedImportTokenRef.current
    encryptedImportTokenRef.current = null
    if (token) void window.vault.cancelEncryptedImport({ token })
    jsonAttemptGateRef.current.invalidate()
    fileReadAttemptRef.current++
    currentJsonTextRef.current = next
    setText(next)
    setJsonPassword('')
    setJsonImportRoot(null)
    setJsonSecretIds({})
    setEncryptedSelectionIds({})
    if (sourceRef.current === 'vaultageJson') setJsonNeedsPassword(looksLikeEncryptedExport(next))
  }

  const clearPreparedImportData = () => {
    const token = encryptedImportTokenRef.current
    encryptedImportTokenRef.current = null
    if (token) void window.vault.cancelEncryptedImport({ token })
    jsonAttemptGateRef.current.invalidate()
    currentJsonTextRef.current = ''
    setText('')
    setJsonPassword('')
    setJsonImportRoot(null)
    setJsonSecretIds({})
    setEncryptedSelectionIds({})
    setParsed([])
    setParseErrors([])
    setIncluded(new Set())
  }

  const handleParse = async () => {
    if (source === 'images') {
      if (parsed.length === 0) { toast.error('Choose one or more images first'); return }
      setStep('preview')
      return
    }

    if (source === 'vaultageJson') {
      if (!text.trim()) { toast.error('Paste or upload a Vaultage export first'); return }
      try {
        let jsonText = text
        if (looksLikeEncryptedExport(text)) {
          if (!jsonPassword) {
            setJsonNeedsPassword(true)
            toast.error('Enter the export password first')
            return
          }
          const encryptedText = text
          let password = jsonPassword
          setJsonPassword('')
          const attempt = jsonAttemptGateRef.current.begin(encryptedText)
          let decrypted
          try {
            decrypted = await window.vault.beginEncryptedImport({ data: encryptedText, password })
          } catch (error) {
            if (!jsonAttemptGateRef.current.isCurrent(attempt, currentJsonTextRef.current)) return
            throw error
          }
          password = ''
          if (!jsonAttemptGateRef.current.isCurrent(attempt, currentJsonTextRef.current)) {
            if (decrypted.token) void window.vault.cancelEncryptedImport({ token: decrypted.token })
            return
          }
          if (!decrypted.success) throw new Error(decrypted.error ?? 'Could not decrypt export')
          if (!decrypted.token || !decrypted.items || typeof decrypted.revision !== 'number') {
            if (decrypted.token) {
              try {
                await window.vault.cancelEncryptedImport({ token: decrypted.token })
              } catch {
                // The malformed preview must not remain usable even if cancellation fails closed.
              }
            }
            throw new Error('Encrypted import preview is incomplete')
          }
          encryptedImportTokenRef.current = decrypted.token
          const rows: PreparedSecret[] = decrypted.items.map((item, index) => ({
            index,
            raw: {
              name: item.name,
              type: item.type,
              value: item.hasValue ? IMPORT_VALUE_MASK : '',
            },
            secret: null,
            error: null,
          }))
          setJsonImportRoot(null)
          setJsonSecretIds({})
          setEncryptedSelectionIds(Object.fromEntries(
            decrypted.items.map((item, index) => [index, item.selectionId]),
          ))
          setParsed(rows)
          setParseErrors([])
          setIncluded(new Set(rows.map(row => row.index)))
          setStep('preview')
          return
        } else {
          jsonAttemptGateRef.current.invalidate()
          setJsonPassword('')
        }
        const vault = parseVaultJson(jsonText)
        const rows = jsonSecretRows(vault)
        setJsonImportRoot(vault.root)
        setJsonSecretIds(Object.fromEntries(rows.map(row => [row.prepared.index, row.secretId])))
        setParsed(rows.map(row => row.prepared))
        setParseErrors([])
        setIncluded(new Set(rows.map(row => row.prepared.index)))
        setStep('preview')
      } catch (err) {
        setParseErrors([String(err)])
        toast.error(`Could not read Vaultage export: ${String(err)}`)
      }
      return
    }

    if (!text.trim()) { toast.error('Paste or upload some CSV first'); return }
    const result = source === 'chrome' || source === 'safari'
      ? (() => {
          const table = parseCsvTable(text)
          return {
            rows: prepareBrowserRows(table.rows, source as BrowserImportSource),
            errors: table.errors,
          }
        })()
      : (() => {
          const { rows, errors } = parseCsv(text)
          return {
            rows: prepareRows(rows),
            errors,
          }
        })()
    const prepared = result.rows
    setParsed(prepared)
    setParseErrors(result.errors.map(e => e.message))
    setIncluded(new Set(prepared.filter(p => !p.error).map(p => p.index)))
    setStep('preview')
  }

  const handleFile = async (file: File) => {
    const expectedSource = source
    replaceImportText('')
    const attemptId = ++fileReadAttemptRef.current
    const maxBytes = source === 'vaultageJson' ? MAX_VAULTAGE_EXPORT_FILE_BYTES : MAX_CSV_IMPORT_BYTES
    const label = source === 'vaultageJson' ? 'Export' : 'CSV'
    if (file.size > maxBytes) {
      toast.error(`${label} is too large. Maximum size is ${Math.round(maxBytes / 1024)} KB.`)
      return
    }
    try {
      const buf = await file.text()
      if (attemptId !== fileReadAttemptRef.current || sourceRef.current !== expectedSource) return
      replaceImportText(buf)
    } catch (error) {
      if (attemptId !== fileReadAttemptRef.current || sourceRef.current !== expectedSource) return
      toast.error(`Could not read ${label.toLowerCase()}: ${String(error)}`)
    }
  }

  const handleImageFiles = async (files: FileList | File[]) => {
    const attemptId = ++imageReadAttemptRef.current
    setParsed([])
    setParseErrors([])
    setIncluded(new Set())
    if (files.length > MAX_IMAGE_IMPORT_SELECTION_COUNT) {
      const error = `Choose at most ${MAX_IMAGE_IMPORT_SELECTION_COUNT} images at a time`
      setParseErrors([error])
      toast.error(error)
      return
    }
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      toast.error('Choose image files')
      return
    }

    const prepared: PreparedSecret[] = []
    const errors: string[] = []
    const selection = await readBoundedImageImportSelection(imageFiles, readImageDataUrl)
    if (attemptId !== imageReadAttemptRef.current) return
    if (!selection.ok) {
      setParseErrors([selection.error])
      toast.error(selection.error)
      return
    }

    for (const item of selection.items) {
      const file = item.file
      const index = prepared.length
      if (!item.dataUrl) {
        errors.push(`Could not read ${file.name}`)
        continue
      }
      prepared.push({
        index,
        raw: { name: imageName(file.name), type: 'image', value: 'image' },
        secret: {
          name: imageName(file.name),
          type: 'image',
          fields: [{ key: '__image__', value: item.dataUrl, sensitive: true }],
          notes: `Imported from ${file.name}`,
          tags: ['image-import'],
        },
        error: null,
      })
    }

    setParsed(prepared)
    setParseErrors(errors)
    setIncluded(new Set(prepared.filter(p => !p.error).map(p => p.index)))
  }

  const handleBack = () => {
    const token = encryptedImportTokenRef.current
    encryptedImportTokenRef.current = null
    if (token) void window.vault.cancelEncryptedImport({ token })
    jsonAttemptGateRef.current.invalidate()
    fileReadAttemptRef.current++
    imageReadAttemptRef.current++
    setJsonPassword('')
    if (step === 'preview') {
      if (source === 'vaultageJson') {
        setJsonImportRoot(null)
        setJsonSecretIds({})
        setEncryptedSelectionIds({})
        setParsed([])
        setParseErrors([])
        setIncluded(new Set())
      }
      setStep('input')
      return
    }
    clearPreparedImportData()
    sourceRef.current = null
    setSource(null)
    setJsonNeedsPassword(false)
    setStep('source')
  }

  const handleDownloadTemplate = async () => {
    try {
      const result = await window.vault.saveImportTemplate()
      if (result.success) toast.success('Template saved')
      else if (!result.cancelled) toast.error(result.error ?? 'Could not save template')
    } catch (error) {
      toast.error(`Could not save template: ${String(error)}`)
    }
  }

  const handleCopyTemplate = async () => {
    const result = await window.vault.copyImportTemplate()
    if (result.success) toast.success('Template copied to clipboard')
    else toast.error(result.error ?? 'Could not copy template')
  }

  // ── Step: Preview ───────────────────────────────────────────────────────

  const toggleRow = (i: number) => {
    setIncluded(s => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  const validCount = parsed.filter(p => !p.error).length
  const errorCount = parsed.length - validCount

  const handleImport = async () => {
    const currentVault = latestVaultRef.current
    if (!folderId || !isCurrentImportDestination(currentVault, folderId)) {
      setFolderId(null)
      toast.error('The destination folder is no longer available. Choose a current folder and try again.')
      return
    }
    if (!currentVault || typeof currentVault.revision !== 'number') {
      toast.error('The vault revision is unavailable. Unlock the vault and try again.')
      return
    }
    setImporting(true)
    try {
      const encryptedToken = encryptedImportTokenRef.current
      if (source === 'vaultageJson' && encryptedToken) {
        const selectionIds = Object.entries(encryptedSelectionIds)
          .filter(([index]) => included.has(Number(index)))
          .map(([, selectionId]) => selectionId)
        const result = await window.vault.commitEncryptedImport({
          token: encryptedToken,
          selectionIds,
          destinationFolderId: folderId,
          expectedRevision: currentVault.revision,
        })
        encryptedImportTokenRef.current = null
        if (!result.success) {
          setEncryptedSelectionIds({})
          setParsed([])
          setIncluded(new Set())
          setStep('input')
          throw new Error(result.error ?? 'Encrypted import failed')
        }
        if (result.folderId) selectFolder(result.folderId)
        if (result.firstSecretId) selectSecret(result.firstSecretId)
        clearPreparedImportData()
        const importedCount = result.secretCount ?? selectionIds.length
        setDoneCount(importedCount)
        toast.success(`Imported ${importedCount} secret${importedCount !== 1 ? 's' : ''}`)
        return
      }
      if (source === 'vaultageJson' && jsonImportRoot) {
        const selectedIds = new Set(
          Object.entries(jsonSecretIds)
            .filter(([index]) => included.has(Number(index)))
            .map(([, secretId]) => secretId),
        )
        const imported = await importFolderTree(folderId, jsonImportRoot, selectedIds)
        if (imported.secretCount > 0) {
          selectFolder(imported.folderId)
          if (imported.firstSecretId) selectSecret(imported.firstSecretId)
        }
        clearPreparedImportData()
        setDoneCount(imported.secretCount)
        toast.success(`Imported ${imported.secretCount} secret${imported.secretCount !== 1 ? 's' : ''}`)
        return
      }

      const secrets = parsed
        .filter(item => included.has(item.index) && item.secret)
        .map(item => item.secret!)
      const imported = await addSecrets(folderId, secrets)
      if (imported.length > 0) {
        selectFolder(folderId)
        selectSecret(imported[0].id)
      }
      clearPreparedImportData()
      setDoneCount(imported.length)
      toast.success(`Imported ${imported.length} secret${imported.length !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(`Import failed: ${String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (doneCount !== null) {
	    return (
	      <Dialog open onOpenChange={open => { if (!open) onClose() }}>
	        <DialogContent className="max-w-md">
	          <DialogHeader>
	            <DialogTitle className="flex items-center gap-2">
	              <CheckCircle2 className="w-5 h-5 text-accent" />
	              Import complete
	            </DialogTitle>
            <DialogDescription className="text-sm text-text-secondary leading-relaxed pt-1">
              Added <strong className="text-text">{doneCount}</strong> secret{doneCount !== 1 ? 's' : ''} to
              your vault.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
	            <Button size="sm" onClick={onClose} title="Close import results. Shortcut: Esc">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

	  return (
	    <Dialog open onOpenChange={open => { if (!open && !importing) onClose() }}>
	      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
	        <DialogHeader>
	          <DialogTitle>
	            {step === 'source' ? 'Migrate your data' : step === 'preview' ? 'Review import' : `Import from ${selectedSource?.label ?? 'source'}`}
	          </DialogTitle>
	          <DialogDescription className="text-sm text-text-secondary">
	            {step === 'source'
	              ? 'Choose a source to bring passwords, CSV rows, or images into Vaultage.'
	              : selectedSource?.description ?? 'Prepare data for import.'}
	          </DialogDescription>
	        </DialogHeader>
	
	        {step === 'source' ? (
	          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-5">
	            <div className="relative">
	              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
	              <input
	                value={query}
	                onChange={e => setQuery(e.target.value)}
	                placeholder="Chrome, Safari, CSV, JSON, images"
	                className="w-full h-11 rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text outline-none focus:border-accent/60"
	              />
	            </div>

	            {filteredSections.length === 0 && (
	              <div className="py-12 text-center text-sm text-text-secondary">No matching import source</div>
	            )}

	            {filteredSections.map(section => (
	              <div key={section.title} className="space-y-3">
	                <p className="text-sm font-semibold text-text">{section.title}</p>
	                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
	                  {section.items.map(item => {
	                    const Icon = item.icon
	                    return (
	                      <button
	                        key={item.id}
	                        onClick={() => chooseSource(item.id)}
	                        title={`Import from ${item.label}. Shortcut: Enter`}
	                        className="h-[132px] rounded-xl border border-border bg-surface/70 hover:bg-white/[0.04] hover:border-accent/45 transition-all flex flex-col items-center justify-center gap-3 px-3 text-center"
	                      >
	                        <Icon className={`w-9 h-9 ${item.iconClassName}`} strokeWidth={1.8} />
	                        <span className="text-sm font-semibold text-text leading-tight">{item.label}</span>
	                        <span className="text-[10px] text-text-secondary leading-snug min-h-[26px]">{item.description}</span>
	                      </button>
	                    )
	                  })}
	                </div>
	              </div>
	            ))}
	          </div>
	        ) : step === 'input' ? (
	          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-4">
	
	            {/* Template helpers */}
	            {source === 'csv' && (
	              <div
	                className="rounded-2xl p-4 flex items-start gap-3"
	                style={{
	                  background: 'rgba(0,255,127,0.04)',
	                  border:     '1px solid rgba(0,255,127,0.18)',
	                }}
	              >
	                <div
	                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
	                  style={{ background: 'rgba(0,255,127,0.12)' }}
	                >
	                  <FileSpreadsheet className="w-4 h-4 text-accent" />
	                </div>
	                <div className="flex-1 min-w-0">
	                  <p className="text-sm font-semibold text-text">Start from a template</p>
	                  <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
	                    Headers: <code className="text-[11px] font-mono text-accent">name, type, value, username, url, notes, scope, tags</code>.
	                    Type defaults to <code className="text-[11px] font-mono">apiKey</code>. Tags are
	                    semicolon-separated.
	                  </p>
	                  <div className="flex gap-2 mt-3">
		                    <Button size="sm" variant="outline" onClick={handleDownloadTemplate} title="Download a CSV template file. Shortcut: Enter">
	                      Download .csv template
	                    </Button>
		                    <Button size="sm" variant="ghost" onClick={handleCopyTemplate} title="Copy the CSV template to the clipboard. Shortcut: Enter">
	                      Copy to clipboard
	                    </Button>
	                  </div>
	                </div>
	              </div>
	            )}
	
	            {source === 'images' ? (
	              <>
	                <div>
	                  <Label className="block mb-1.5">Choose images</Label>
		                  <button
		                    onClick={() => imageInputRef.current?.click()}
		                    title="Choose image files to import as image secrets. Shortcut: Enter"
		                    className="w-full flex items-center justify-center gap-2 px-4 py-8 rounded-xl border border-dashed border-border text-sm text-text-secondary hover:text-text hover:border-accent/40 hover:bg-white/[0.02] transition-all"
	                  >
	                    <ImageIcon className="w-4 h-4" />
	                    Select image files
	                  </button>
	                  <input
	                    ref={imageInputRef}
	                    type="file"
	                    accept="image/png,image/jpeg,image/gif,image/webp"
	                    multiple
	                    className="hidden"
	                    onChange={e => { if (e.target.files) handleImageFiles(e.target.files) }}
	                  />
	                </div>
	                {parsed.length > 0 && (
	                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
	                    {parsed.map(item => (
	                      <div key={item.index} className="rounded-xl border border-border bg-surface/60 overflow-hidden">
	                        {item.secret?.fields[0]?.value ? (
	                          <img src={item.secret.fields[0].value} alt="" className="w-full h-28 object-cover bg-black/30" />
	                        ) : (
	                          <div className="w-full h-28 flex items-center justify-center text-danger text-xs bg-black/20">{item.error}</div>
	                        )}
	                        <div className="p-2 text-xs text-text truncate" title={item.raw.name}>{item.raw.name}</div>
	                      </div>
	                    ))}
	                  </div>
	                )}
	              </>
	            ) : source === 'vaultageJson' ? (
	              <>
	                <div
	                  className="rounded-2xl p-4 flex items-start gap-3"
	                  style={{
	                    background: 'rgba(139,92,246,0.06)',
	                    border:     '1px solid rgba(139,92,246,0.22)',
	                  }}
	                >
	                  <div
	                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
	                    style={{ background: 'rgba(139,92,246,0.14)' }}
	                  >
	                    <LockKeyhole className="w-4 h-4 text-violet-300" />
	                  </div>
	                  <div className="flex-1 min-w-0">
	                    <p className="text-sm font-semibold text-text">Vaultage export</p>
	                    <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
	                      Imports plaintext JSON exports and password-protected <code className="text-[11px] font-mono">.vaultage-export</code> files.
	                      Folder structure is preserved under the destination folder.
	                    </p>
	                  </div>
	                </div>

	                <div>
	                  <Label className="block mb-1.5">Upload export</Label>
		                  <button
		                    onClick={() => fileInputRef.current?.click()}
		                    title="Choose a Vaultage JSON or encrypted export file. Shortcut: Enter"
		                    className="w-full flex items-center justify-center gap-2 px-4 py-6 rounded-xl border border-dashed border-border text-sm text-text-secondary hover:text-text hover:border-accent/40 hover:bg-white/[0.02] transition-all"
	                  >
	                    <UploadCloud className="w-4 h-4" />
	                    Choose a .json or .vaultage-export file
	                  </button>
	                  <input
	                    ref={fileInputRef}
	                    type="file"
	                    accept=".json,.vaultage-export,application/json"
	                    className="hidden"
	                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
	                  />
	                </div>

	                <div>
	                  <Label className="block mb-1.5">Export password</Label>
	                  <Input
	                    type="password"
	                    data-secure-input="true"
	                    value={jsonPassword}
	                    onChange={e => {
	                      jsonAttemptGateRef.current.invalidate()
	                      setJsonPassword(e.target.value)
	                    }}
	                    placeholder={jsonNeedsPassword ? 'Required for encrypted export' : 'Only needed for encrypted exports'}
	                    className={jsonNeedsPassword && !jsonPassword ? 'border-danger/50 focus:border-danger' : undefined}
	                  />
	                </div>

	                <div>
	                  <Label className="block mb-1.5">Or paste export JSON</Label>
	                  <Textarea
	                    value={text}
	                    onChange={e => replaceImportText(e.target.value)}
	                    placeholder={'{\n  "format": "vaultage.export.v1",\n  "vault": { ... }\n}'}
	                    className="font-mono text-[11px] min-h-[180px]"
	                  />
	                </div>
	              </>
	            ) : (
	              <>
	                {/* Upload */}
	                <div>
	                  <Label className="block mb-1.5">Upload CSV</Label>
		                  <button
		                    onClick={() => fileInputRef.current?.click()}
		                    title="Choose a CSV file to import. Shortcut: Enter"
		                    className="w-full flex items-center justify-center gap-2 px-4 py-6 rounded-xl border border-dashed border-border text-sm text-text-secondary hover:text-text hover:border-accent/40 hover:bg-white/[0.02] transition-all"
	                  >
	                    <UploadCloud className="w-4 h-4" />
	                    Choose a .csv file
	                  </button>
	                  <input
	                    ref={fileInputRef}
	                    type="file"
	                    accept=".csv,text/csv"
	                    className="hidden"
	                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
	                  />
	                </div>
	
	                {/* Paste */}
	                <div>
	                  <Label className="block mb-1.5">Or paste CSV content</Label>
	                  <Textarea
	                    value={text}
	                    onChange={e => replaceImportText(e.target.value)}
	                    placeholder={
	                      source === 'chrome'
	                        ? 'name,url,username,password,note\nExample,https://example.com,me@example.com,password123,Personal'
	                        : source === 'safari'
	                          ? 'Title,URL,Username,Password,Notes,OTPAuth\nExample,https://example.com,me@example.com,password123,,'
	                          : 'name,type,value,username,url,notes,scope,tags\n"GitHub Token",apiKey,ghp_xxxx,,https://github.com,,production,dev;github'
	                    }
	                    className="font-mono text-[11px] min-h-[160px]"
	                  />
	                </div>
	              </>
	            )}
	          </div>
	        ) : (
          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-3">

            {/* Summary */}
            <div className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary">
                  <span className="text-text font-medium">{validCount}</span> valid
                  {errorCount > 0 && (
                    <> · <span className="text-danger font-medium">{errorCount}</span> invalid</>
                  )}
                  {' '}· {included.size} selected
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
	                <button
	                  onClick={() => setIncluded(new Set(parsed.filter(p => !p.error).map(p => p.index)))}
	                  title="Select all valid rows. Shortcut: Enter"
	                  className="text-[11px] text-text-secondary hover:text-text transition-colors"
                >
                  Select all
                </button>
                <span className="text-text-secondary">·</span>
	                <button
	                  onClick={() => setIncluded(new Set())}
	                  title="Clear selected rows. Shortcut: Enter"
	                  className="text-[11px] text-text-secondary hover:text-text transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Parse warnings */}
            {parseErrors.length > 0 && (
              <Alert>
                <AlertDescription className="text-xs">
                  {parseErrors.map((e, i) => <div key={i}>· {e}</div>)}
                </AlertDescription>
              </Alert>
            )}

            {/* Preview table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[28px_1fr_90px_1fr_100px] gap-2 px-3 py-2 bg-white/[0.02] border-b border-border text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                <div />
                <div>Name</div>
                <div>Type</div>
                <div>Value (hidden)</div>
                <div className="text-right">Status</div>
              </div>
              {parsed.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-text-secondary">No rows parsed</div>
              )}
              {parsed.map(item => (
	                <label
	                  key={item.index}
	                  title={item.error ? 'This row cannot be imported.' : 'Toggle this row for import. Shortcut: Enter'}
	                  className={
                    'grid grid-cols-[28px_1fr_90px_1fr_100px] gap-2 px-3 py-2 border-b border-border/40 last:border-0 text-xs ' +
                    (item.error ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.02]')
                  }
                >
                  <Checkbox
                    checked={included.has(item.index)}
                    onCheckedChange={() => !item.error && toggleRow(item.index)}
                    disabled={!!item.error}
                  />
                  <span className="text-text truncate" title={item.raw.name}>{item.raw.name || '—'}</span>
                  <span className="text-text-secondary truncate">
                    {item.secret ? SECRET_TYPE_LABELS[item.secret.type] : (item.raw.type || '—')}
                  </span>
                  <ImportPreviewValue item={item} />
                  <span className={'text-right truncate ' + (item.error ? 'text-danger' : 'text-accent')} title={item.error ?? 'OK'}>
                    {item.error ?? 'OK'}
                  </span>
                </label>
              ))}
            </div>

            {/* Folder target */}
            <div>
              <Label className="block mb-1.5">Import into folder</Label>
              <Select value={folderId ?? undefined} onValueChange={setFolderId}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Choose a folder" />
                </SelectTrigger>
                <SelectContent>
                  {folders.map(f => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

	        <DialogFooter className="pt-2">
	          {step === 'source' ? (
		            <Button variant="outline" size="sm" onClick={onClose} title="Cancel import. Shortcut: Esc">Cancel</Button>
	          ) : step === 'input' ? (
	            <>
		              <Button variant="outline" size="sm" onClick={handleBack} title="Go back to source selection. Shortcut: Esc">
	                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
	                Back
	              </Button>
		              <Button size="sm" onClick={handleParse} disabled={source === 'images' ? parsed.length === 0 : !text.trim()} title="Preview parsed import rows. Shortcut: Enter">
	                Preview
	              </Button>
	            </>
	          ) : (
	            <>
		              <Button variant="outline" size="sm" onClick={handleBack} disabled={importing} title="Return to import input. Shortcut: Esc">
	                Back
	              </Button>
	              <Button
	                size="sm"
	                onClick={handleImport}
	                disabled={importing || included.size === 0 || !isCurrentImportDestination(state.vault, folderId)}
	                title="Import the selected rows into the chosen folder. Shortcut: Enter"
	              >
                {importing ? 'Importing…' : `Import ${included.size} secret${included.size !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
