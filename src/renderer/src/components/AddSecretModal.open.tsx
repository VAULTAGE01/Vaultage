import { useEffect, useRef, useState } from 'react'
import { useVault } from '../vaultContext'
import type { SecretField, SecretType, VaultSecret } from '../types'
import { SCOPE_PRESETS, SECRET_TEMPLATES, SECRET_TYPE_LABELS } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import { isRedactedSecretValue } from '../../../shared/vaultRedaction'
import {
  authoredRevisionForSecretUpdate,
  captureSecretFormAuthorship,
  secretFormSaveError,
} from '../lib/secretFormAuthorship'

export {
  authoredRevisionForSecretUpdate,
  captureSecretFormAuthorship,
  secretFormSaveError,
  type SecretFormAuthorship,
} from '../lib/secretFormAuthorship'

const TYPES: SecretType[] = ['password', 'apiKey', 'sshKey', 'secureNote', 'custom', 'image']

function blankField(): SecretField {
  return { key: '', value: '', sensitive: true }
}

interface Props {
  folderId: string
  existing?: VaultSecret
  defaultScope?: string
  defaultType?: SecretType
  onClose: () => void
}

export default function AddSecretModal({ folderId, existing, defaultScope, defaultType, onClose }: Props) {
  const { state, addSecret, updateSecret } = useVault()
  const isEdit = Boolean(existing)
  const authorshipRef = useRef(captureSecretFormAuthorship(existing, state.vault?.revision))
  const initialType = existing?.type ?? defaultType ?? 'password'
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<SecretType>(initialType)
  const [fields, setFields] = useState<SecretField[]>(
    existing?.fields?.length
      ? existing.fields.map(field => ({ ...field }))
      : SECRET_TEMPLATES[initialType].map(field => ({ ...field })),
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [scope, setScope] = useState(existing?.scope ?? defaultScope ?? '')
  const [tagsRaw, setTagsRaw] = useState((existing?.tags ?? []).join(', '))
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt ?? '')
  const [usedInRaw, setUsedInRaw] = useState((existing?.usedIn ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const imageField = type === 'image' ? fields.find(field => field.key === '__image__') : null
  const imageData = imageField && !isRedactedSecretValue(imageField.value)
    ? (imageField.value || null)
    : null
  const hasHiddenStoredImage = Boolean(imageField && isRedactedSecretValue(imageField.value))

  const setImageData = (dataUrl: string) => {
    setFields([{ key: '__image__', value: dataUrl, sensitive: true }])
  }

  useEffect(() => {
    if (type !== 'image') return

    const handler = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? [])
      const imageItem = items.find(item => item.type.startsWith('image/'))
      if (!imageItem) return

      const file = imageItem.getAsFile()
      if (!file) return

      const reader = new FileReader()
      reader.onload = readerEvent => {
        if (readerEvent.target?.result) setImageData(readerEvent.target.result as string)
      }
      reader.readAsDataURL(file)
    }

    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [type])

  const changeType = (next: SecretType) => {
    setType(next)
    if (!isEdit || type === 'image' || next === 'image') {
      setFields(SECRET_TEMPLATES[next].map(field => ({ ...field })))
    }
  }

  const updateField = (index: number, patch: Partial<SecretField>) => {
    setFields(prev => prev.map((field, i) => i === index ? { ...field, ...patch } : field))
  }

  const removeField = (index: number) => {
    setFields(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))
  }

  const save = async () => {
    const cleanName = name.trim()
    if (!cleanName) return
    const cleanFields = fields
      .map(field => ({ ...field, key: field.key.trim() }))
      .filter(field => field.key)
    if (cleanFields.length === 0) return
    if (type === 'image' && !imageData && !hasHiddenStoredImage) return

    setSaving(true)
    setSaveError(null)
    try {
      const tags = tagsRaw.split(',').map(tag => tag.trim()).filter(Boolean)
      const usedIn = usedInRaw.split('\n').map(entry => entry.trim()).filter(Boolean)
      const data = {
        name: cleanName,
        type,
        fields: cleanFields,
        notes,
        description: description.trim() || undefined,
        scope: scope.trim() || undefined,
        tags: tags.length ? tags : undefined,
        expiresAt: expiresAt || undefined,
        usedIn: usedIn.length ? usedIn : undefined,
      }

      if (existing) {
        const authoredRevision = authoredRevisionForSecretUpdate(authorshipRef.current, existing.id)
        await updateSecret(folderId, { ...existing, ...data }, authoredRevision)
      }
      else await addSecret(folderId, data)
      onClose()
    } catch (error) {
      setSaveError(secretFormSaveError(error))
    } finally {
      setSaving(false)
    }
  }

  const imageMissing = type === 'image' && !imageData && !hasHiddenStoredImage

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-h-[88vh] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto p-0 no-drag">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{isEdit ? 'Edit Secret' : 'New Secret'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger"
            >
              {saveError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. GitHub token"
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={value => changeType(value as SecretType)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map(secretType => (
                    <SelectItem key={secretType} value={secretType}>
                      {SECRET_TYPE_LABELS[secretType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === 'image' ? (
            <div>
              <Label>Image</Label>
              {imageData ? (
                <div className="group relative mt-1 overflow-hidden rounded-lg border border-border bg-black/10">
                  <img src={imageData} alt="Pasted secret" className="max-h-64 w-full object-contain" />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setFields([{ key: '__image__', value: '', sensitive: true }])}
                    className="absolute right-2 top-2 bg-black/60 text-white opacity-0 hover:bg-danger/80 group-hover:opacity-100"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-black/10 p-6 text-center text-muted">
                  <ImageIcon className="h-8 w-8 opacity-50" />
                  <p className="text-xs">{hasHiddenStoredImage ? 'Stored image hidden' : 'Paste a screenshot with Cmd+V'}</p>
                  <p className="text-[11px] opacity-70">
                    {hasHiddenStoredImage ? 'Leave unchanged, paste a replacement, or remove it.' : 'PNG, JPEG, and GIF images are supported.'}
                  </p>
                  {hasHiddenStoredImage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setFields([{ key: '__image__', value: '', sensitive: true }])}
                    >
                      Remove image
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Fields</Label>
                <Button variant="outline" size="sm" onClick={() => setFields(prev => [...prev, blankField()])}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Field
                </Button>
              </div>
              {fields.map((field, index) => {
                const redactedValue = isRedactedSecretValue(field.value)
                return (
                  <div key={index} className="grid gap-2 rounded-lg border border-border bg-black/10 p-3 sm:grid-cols-[150px_1fr_auto_auto]">
                    <Input
                      value={field.key}
                      onChange={event => updateField(index, { key: event.target.value })}
                      placeholder="Field name"
                    />
                    <Input
                      value={redactedValue ? '' : field.value}
                      onChange={event => updateField(index, { value: event.target.value })}
                      placeholder={redactedValue ? 'Leave unchanged' : 'Value'}
                      type={field.sensitive ? 'password' : 'text'}
                    />
                    <label className="flex items-center gap-2 whitespace-nowrap rounded-md border border-border px-3 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={field.sensitive}
                        onChange={event => updateField(index, { sensitive: event.target.checked })}
                      />
                      Sensitive
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={fields.length <= 1}
                      onClick={() => removeField(index)}
                      title="Remove field"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Scope</Label>
              <Select value={scope || 'none'} onValueChange={value => setScope(value === 'none' ? '' : value)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectSeparator />
                  {SCOPE_PRESETS.map(preset => (
                    <SelectItem key={preset} value={preset}>
                      {preset}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expires</Label>
              <Input
                className="mt-1"
                type="date"
                value={expiresAt}
                onChange={event => setExpiresAt(event.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input
              className="mt-1"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="What this secret is for"
            />
          </div>

          <div>
            <Label>Tags</Label>
            <Input
              className="mt-1"
              value={tagsRaw}
              onChange={event => setTagsRaw(event.target.value)}
              placeholder="comma, separated, tags"
            />
          </div>

          <div>
            <Label>Used In</Label>
            <Textarea
              className="mt-1 min-h-20"
              value={usedInRaw}
              onChange={event => setUsedInRaw(event.target.value)}
              placeholder="One project, app, or note per line"
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              className="mt-1 min-h-24"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Private notes stored in the encrypted vault"
            />
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim() || imageMissing}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
