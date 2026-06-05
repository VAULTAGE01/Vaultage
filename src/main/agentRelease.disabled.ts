import type { ResolvedEnvSelection as AgentReleaseEntry } from './envSelections'

export type {
  EnvSelection as AgentReleaseSelection,
  ResolvedEnvSelection as AgentReleaseEntry,
} from './envSelections'

export function resolveAgentReleaseSelections(_vault: unknown, _selections: unknown): AgentReleaseEntry[] {
  throw new Error('This capability is not included in this Vaultage edition.')
}
