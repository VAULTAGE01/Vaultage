export const SECRET_REVEAL_CONFIRM_PHRASE = 'REVEAL SECRET'
export const PLAINTEXT_EXPORT_CONFIRM_PHRASE = 'EXPORT PLAINTEXT'

export type TextInputValidation =
  | { kind: 'non-empty' }
  | { kind: 'exact'; expected: string }

export interface TextInputRequestOptions {
  title: string
  description: string
  label: string
  confirmLabel: string
  placeholder?: string
  initialValue?: string
  validation: TextInputValidation
}

export type RequestTextInput = (options: TextInputRequestOptions) => Promise<string | null>

export function textInputValueIsValid(value: string, validation: TextInputValidation): boolean {
  if (validation.kind === 'non-empty') return value.trim().length > 0
  return value === validation.expected
}

export async function createFolderFromInput(
  parentFolderId: string,
  input: string | null,
  addFolder: (parentFolderId: string, name: string) => Promise<void>,
): Promise<boolean> {
  const name = input?.trim() ?? ''
  if (!name) return false
  await addFolder(parentFolderId, name)
  return true
}

export async function requestSecretRevealConfirmation(
  platform: string,
  requestTextInput: RequestTextInput,
): Promise<string | undefined | null> {
  if (platform === 'darwin') return undefined
  return requestTextInput({
    title: 'Confirm secret reveal',
    description: `Type ${SECRET_REVEAL_CONFIRM_PHRASE} exactly to reveal this saved value.`,
    label: 'Confirmation phrase',
    confirmLabel: 'Reveal secret',
    placeholder: SECRET_REVEAL_CONFIRM_PHRASE,
    validation: { kind: 'exact', expected: SECRET_REVEAL_CONFIRM_PHRASE },
  })
}

export async function requestPlaintextExportConfirmation(
  options: Readonly<{ platform: string; e2eBypass?: boolean }>,
  requestTextInput: RequestTextInput,
): Promise<string | undefined | null> {
  if (options.platform === 'darwin' || options.e2eBypass === true) return undefined
  return requestTextInput({
    title: 'Export decrypted image',
    description: `Type ${PLAINTEXT_EXPORT_CONFIRM_PHRASE} exactly to save this image outside the encrypted vault.`,
    label: 'Confirmation phrase',
    confirmLabel: 'Save image',
    placeholder: PLAINTEXT_EXPORT_CONFIRM_PHRASE,
    validation: { kind: 'exact', expected: PLAINTEXT_EXPORT_CONFIRM_PHRASE },
  })
}
