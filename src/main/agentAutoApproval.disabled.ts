export interface AgentAutoApprovalClientMetadata {
  id: string
  label: string
  tokenFingerprint: string
  generation: number
  createdAt: string
}

export interface AgentAutoApprovalGrantMetadata {
  id: string
  clientId: string
  projectId: string
  environmentId: string
  environmentScope: string
  project: { realPath: string; dev: string; ino: string }
  selections: Array<{ envKey: string; secretId: string; fieldId?: string; fieldKey: string; scope: string }>
  delivery: 'response'
  production: false
  createdAt: string
  expiresAt: string
}

export interface AgentAutoApprovalMatch {
  client: AgentAutoApprovalClientMetadata
  grant: AgentAutoApprovalGrantMetadata
}

export class AgentAutoApprovalStore {
  async authenticateClient(_key: Buffer, _token: string): Promise<AgentAutoApprovalClientMetadata | null> {
    return null
  }

  async list(_key: Buffer, _sessionId?: string): Promise<{
    clients: AgentAutoApprovalClientMetadata[]
    grants: AgentAutoApprovalGrantMetadata[]
  }> {
    return { clients: [], grants: [] }
  }

  async createClient(_key: Buffer, _label: string): Promise<never> {
    throw new Error('Agent credentials are unavailable in this build')
  }

  async createGrant(_key: Buffer, _input: unknown): Promise<AgentAutoApprovalGrantMetadata> {
    throw new Error('Agent auto-approval is unavailable in this build')
  }

  async match(_key: Buffer, _input: unknown): Promise<AgentAutoApprovalMatch | null> {
    return null
  }

  async revokeClient(_key: Buffer, _clientId: string): Promise<boolean> {
    return false
  }

  async revokeGrant(_key: Buffer, _grantId: string): Promise<boolean> {
    return false
  }

  async clear(): Promise<void> {}
}
