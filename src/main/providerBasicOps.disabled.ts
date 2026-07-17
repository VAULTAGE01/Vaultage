type Cfg = Record<string, string>
type ProviderSecretRow = {
  name: string
  value?: string
  description?: string
  target?: string[]
  updatedAt?: string
  issuedAt?: string
  kind?: 'secret' | 'token'
  remoteId?: string
  status?: string
  lastUsedAt?: string
  expiresAt?: string
  tokenOwner?: 'user' | 'account'
}
type ProviderInventory = {
  rows: ProviderSecretRow[]
  truncated: boolean
  pages: number
  rowLimit: number
  pageLimit: number
}

const unavailable = 'Provider integrations are available in Vaultage Pro.'

export async function providerList(_type: string, _cfg: Cfg): Promise<ProviderSecretRow[]> {
  throw new Error(unavailable)
}

export async function providerListInventory(_type: string, _cfg: Cfg): Promise<ProviderInventory> {
  throw new Error(unavailable)
}

export async function providerSet(
  _type: string,
  _cfg: Cfg,
  _name: string,
  _value: string,
): Promise<void> {
  throw new Error(unavailable)
}

export async function verifyCloudflareToken(_token: string, _accountId?: string): Promise<void> {
  throw new Error(unavailable)
}
