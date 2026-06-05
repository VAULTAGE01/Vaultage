type Cfg = Record<string, string>
type CloudflarePermissionGroup = { id: string; name: string; scope?: string }
type CloudflareCreateTokenPayload = Record<string, unknown>
type CloudflareCreateTokenResult = Record<string, unknown>
type CloudflareRollTokenResult = Record<string, unknown>

const unavailable = 'Provider lifecycle automation is available in Vaultage Pro.'

export async function providerDelete(
  _type: string,
  _cfg: Cfg,
  _name: string,
  _opts: { kind?: 'secret' | 'token'; remoteId?: string; tokenOwner?: 'user' | 'account' } = {},
): Promise<void> {
  throw new Error(unavailable)
}

export async function listCloudflarePermissionGroups(
  _token: string,
  _accountId?: string,
): Promise<CloudflarePermissionGroup[]> {
  throw new Error(unavailable)
}

export async function createCloudflareToken(
  _payload: CloudflareCreateTokenPayload,
): Promise<CloudflareCreateTokenResult> {
  throw new Error(unavailable)
}

export async function rollCloudflareToken(
  _token: string,
  _tokenId: string,
  _accountId?: string,
  _tokenOwner?: 'user' | 'account',
): Promise<CloudflareRollTokenResult> {
  throw new Error(unavailable)
}
