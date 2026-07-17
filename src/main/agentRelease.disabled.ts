import type { ResolvedEnvSelection as AgentReleaseEntry } from './envSelections'

export type {
  EnvSelection as AgentReleaseSelection,
  ResolvedEnvSelection as AgentReleaseEntry,
} from './envSelections'

export function resolveAgentReleaseSelections(_vault: unknown, _selections: unknown): AgentReleaseEntry[] {
  throw new Error('This capability is not included in this Vaultage edition.')
}

export interface AgentProjectReleaseResolution {
  projectId: string
  environmentId: string
  environmentScope: string
  projectPath: string
  entries: AgentReleaseEntry[]
}

export function resolveAgentProjectRelease(
  _vault: unknown,
  _projectPath: string,
  _requestedKeys: readonly string[],
): AgentProjectReleaseResolution {
  throw new Error('This capability is not included in this Vaultage edition.')
}
