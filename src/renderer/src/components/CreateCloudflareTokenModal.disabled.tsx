import type { Provider } from '../types'

interface Props {
  provider: Provider
  onViewSavedToken?: (folderId: string, secretId: string) => void
  onClose: () => void
}

export default function CreateCloudflareTokenModal({
  provider,
  onViewSavedToken,
  onClose,
}: Props) {
  void provider
  void onViewSavedToken
  onClose()
  return null
}
