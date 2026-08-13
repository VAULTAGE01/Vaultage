import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import type { CertificateMetadata } from '../types'
import { readCertificateImportFile } from '../lib/certificateImportFile'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export interface ImportedCertificateMaterial {
  readonly metadata: CertificateMetadata
  readonly storedValue: string
}

interface Props {
  readonly onPreviewStart: () => void
  readonly onImported: (material: ImportedCertificateMaterial) => void
  readonly onImportError: (message: string) => void
}

/** User-driven local certificate preview; only validated metadata leaves the main process. */
export default function CertificateImportPanel({ onPreviewStart, onImported, onImportError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const importGeneration = useRef(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const previewSelectedFile = async (file: File) => {
    const generation = ++importGeneration.current
    onPreviewStart()
    setFileName(null)
    setIsImporting(true)
    try {
      const selected = await readCertificateImportFile(file)
      const result = await window.vault.previewCertificateMetadata({
        format: selected.format,
        certificateBase64: selected.certificateBase64,
      })
      if (generation !== importGeneration.current) return
      if (!result.success || !result.certificate) {
        onImportError(result.error ?? 'Could not read certificate metadata.')
        return
      }
      onImported({ metadata: result.certificate, storedValue: selected.storedValue })
      setFileName(selected.fileName)
    } catch (error) {
      if (generation !== importGeneration.current) return
      onImportError(error instanceof Error ? error.message : 'Could not read certificate metadata.')
    } finally {
      if (generation === importGeneration.current) setIsImporting(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-black/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Label htmlFor="certificate-file">Import certificate</Label>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">PEM or DER, up to 1 MB. Metadata is previewed locally before saving.</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isImporting}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {isImporting ? 'Reading…' : 'Choose file'}
        </Button>
      </div>
      <input
        ref={inputRef}
        id="certificate-file"
        className="sr-only"
        type="file"
        accept=".pem,.crt,.cer,.der,application/x-pem-file,application/pkix-cert"
        onChange={event => {
          const [file] = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (file) void previewSelectedFile(file)
        }}
      />
      {fileName && (
        <p role="status" className="mt-2 text-[11px] text-muted">
          Metadata loaded from {fileName}. Certificate material will be saved in the sensitive Certificate field.
        </p>
      )}
    </div>
  )
}
