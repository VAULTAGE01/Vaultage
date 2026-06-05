interface Props {
  existing?: unknown
  initialType?: string
  onClose: () => void
}

export default function AddProviderModal({ existing, initialType, onClose }: Props) {
  void existing
  void initialType
  onClose()
  return null
}
