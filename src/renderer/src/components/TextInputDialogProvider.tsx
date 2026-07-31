import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  textInputValueIsValid,
  type RequestTextInput,
  type TextInputRequestOptions,
} from '@/lib/textInputRequests'

interface PendingTextInputRequest {
  id: number
  options: TextInputRequestOptions
  resolve: (value: string | null) => void
}

interface VisibleTextInputRequest {
  id: number
  options: TextInputRequestOptions
}

const TextInputDialogContext = createContext<RequestTextInput | null>(null)

export function TextInputDialogProvider({ children }: { children: ReactNode }) {
  const nextIdRef = useRef(1)
  const activeRef = useRef<PendingTextInputRequest | null>(null)
  const queueRef = useRef<PendingTextInputRequest[]>([])
  const [active, setActive] = useState<VisibleTextInputRequest | null>(null)
  const [value, setValue] = useState('')

  const activateNext = useCallback(() => {
    if (activeRef.current) return
    const next = queueRef.current.shift() ?? null
    activeRef.current = next
    setActive(next ? { id: next.id, options: next.options } : null)
    setValue(next?.options.initialValue ?? '')
  }, [])

  const requestTextInput = useCallback<RequestTextInput>((options) => new Promise(resolve => {
    queueRef.current.push({
      id: nextIdRef.current,
      options,
      resolve,
    })
    nextIdRef.current += 1
    activateNext()
  }), [activateNext])

  const settle = useCallback((result: string | null) => {
    const current = activeRef.current
    if (!current) return
    activeRef.current = null
    current.resolve(result)
    activateNext()
  }, [activateNext])

  useEffect(() => () => {
    activeRef.current?.resolve(null)
    activeRef.current = null
    for (const pending of queueRef.current.splice(0)) pending.resolve(null)
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!active || !textInputValueIsValid(value, active.options.validation)) return
    settle(value)
  }

  return (
    <TextInputDialogContext.Provider value={requestTextInput}>
      {children}
      <Dialog open={active !== null} onOpenChange={open => { if (!open) settle(null) }}>
        {active && (
          <DialogContent
            hideClose
            className="max-w-md"
            aria-describedby={`text-input-description-${active.id}`}
          >
            <form onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{active.options.title}</DialogTitle>
                <DialogDescription
                  id={`text-input-description-${active.id}`}
                  className="text-muted-light"
                >
                  {active.options.description}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 px-6 py-5">
                <Label htmlFor={`text-input-${active.id}`}>{active.options.label}</Label>
                <Input
                  id={`text-input-${active.id}`}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="liquid-modal-input"
                  value={value}
                  placeholder={active.options.placeholder}
                  onChange={event => setValue(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => settle(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!textInputValueIsValid(value, active.options.validation)}
                >
                  {active.options.confirmLabel}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </TextInputDialogContext.Provider>
  )
}

export function useTextInputDialog(): RequestTextInput {
  const requestTextInput = useContext(TextInputDialogContext)
  if (!requestTextInput) {
    throw new Error('useTextInputDialog must be inside TextInputDialogProvider')
  }
  return requestTextInput
}
