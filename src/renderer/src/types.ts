import type { ServiceCategoryId } from '#service-categories'

export type SecretType = 'password' | 'apiKey' | 'sshKey' | 'secureNote' | 'custom' | 'image'

export interface SecretField {
  key:       string
  value:     string
  sensitive: boolean
}

export interface VaultSecret {
  id:          string
  name:        string
  type:        SecretType
  fields:      SecretField[]
  notes:       string
  createdAt:   string
  updatedAt:   string
  // ── metadata ──────────────────────────
  description?: string
  scope?:       string           // "production" | "staging" | "development" | custom
  tags?:        string[]
  expiresAt?:   string           // ISO date
  usedIn?:      string[]         // legacy/manual usage notes; structured usage lives in envProjects
  lastUsedAt?:  string           // ISO date, auto-set on copy
  usageCount?:  number           // auto-incremented on copy
  // ── provider bi-link (G3, G4) ─────────
  // Set when this secret is linked to a specific configured provider in Vaultage.
  // Enables bidirectional navigation: secret ↔ provider ↔ projects-that-use-it.
  providerLink?: ProviderLink
  // ── agent access control ──────────────
  // Opt-in gate. When undefined or false, an agent request for this secret
  // surfaces an extra warning to the user during approval. When true, the
  // user has explicitly marked this secret as "ok to share with agents."
  // Touch ID is still required per request — this only governs surfacing.
  agentAvailable?: boolean
}

export interface ProviderLink {
  providerId:        string    // FK → Provider.id
  remoteName:        string    // name on the provider (the API key's identifier)
  createdInVaultage: boolean   // true = Vaultage created this token via provider API
  scopes?:           string[]  // permission scopes (Cloudflare/GitHub/Stripe)
  remoteId?:         string    // provider-side token ID, for revocation
  lastVerifiedAt?:   string    // last time we confirmed it still exists at the provider
  status?:           ProviderLinkStatus
  statusUpdatedAt?:  string
}

export type ProviderLinkStatus = 'active' | 'revoked' | 'missing'

export interface VaultFolder {
  id:       string
  name:     string
  children: VaultFolder[]
  secrets:  VaultSecret[]
  itemOrder?: VaultTreeItemRef[] // mixed sidebar order for child folders + secrets
}

export type VaultTreeItemKind = 'folder' | 'secret'

export interface VaultTreeItemRef {
  kind: VaultTreeItemKind
  id:   string
}

// ── Providers ──────────────────────────────────────────────────────────────────

export type ProviderType = 'doppler' | 'vercel' | 'cloudflare' | 'gitlab' | 'custom'

export interface Provider {
  id:         string
  name:       string
  type:       ProviderType
  config:     Record<string, string>   // all config incl. credentials, stored encrypted
  lastSyncAt?: string
  groupId?:   string | null
}

export interface ProviderGroup {
  id:   string
  name: string
  /**
   * Set when the group was auto-created from a service-catalog category. Lets
   * the group render the same icon as the catalog and lets newly connected
   * services of that category be filed into the existing folder.
   */
  categoryId?: ServiceCategoryId
}

// Normalised secret shape returned by any provider
export interface ProviderSecret {
  name:        string
  value?:      string   // undefined = provider can't return values (Cloudflare)
  description?: string
  target?:     string[] // Vercel: ['production','preview','development']
  updatedAt?:  string
  // ── for provider-level objects beyond env-style secrets ─────
  kind?:       'secret' | 'token'   // default 'secret'; 'token' = API token issued by provider
  remoteId?:   string                // provider-side ID (needed for revoke)
  status?:     string                // e.g. 'active' | 'disabled' | 'expired'
  issuedAt?:   string                // ISO date — creation time
  lastUsedAt?: string                // ISO date — populated for tokens
  expiresAt?:  string                // ISO date — populated for tokens
  tokenOwner?: 'user' | 'account'    // Cloudflare: user-owned vs account-owned API token
}

// ── Env projects ───────────────────────────────────────────────────────────────

export interface EnvEntry {
  secretId: string
  fieldKey: string  // which SecretField.key to read (e.g. "API Key")
  envKey:   string  // name in the .env file (e.g. "OPENAI_API_KEY")
}

export interface EnvProject {
  id:              string
  name:            string
  path:            string        // absolute path to target project folder
  entries:         EnvEntry[]
  addToGitignore:  boolean
  manualScanFiles?: string[]     // extra files to inspect for unusual project layouts
  lastExportAt?:   string
}

// ── Root ──────────────────────────────────────────────────────────────────────

export interface VaultRoot {
  version:        number
  revision?:      number
  root:           VaultFolder
  providers:      Provider[]
  providerGroups?: ProviderGroup[]
  envProjects:    EnvProject[]
  preferences?: VaultPreferences
}

export interface VaultPreferences {
  localDefaultFoldersCreated?: boolean
  /**
   * When true, new secrets default to `agentAvailable: true`. Even when on,
   * production-scoped secrets always default to off — solo builders shouldn't
   * be one keystroke away from exposing prod credentials to an agent.
   */
  defaultAgentAvailable?: boolean
  agentApiPort?: number
  onboardingResearchSurvey?: OnboardingResearchSurveyPreference
  providerVotes?: Record<string, ProviderVotePreference>
  localDashboardPinnedOrder?: string[]
  localDashboardOnboardingDismissed?: boolean
  quickRevealPinEnabled?: boolean
  quickRevealPin?: QuickRevealPinPreference
  accountCreated?: boolean
}

export interface QuickRevealPinPreference {
  version: 1
  scrypt: {
    N: number
    r: number
    p: number
    keylen: number
    salt: string
  }
  verifier: string
  updatedAt: string
}

export type OnboardingResearchSurveyStatus = 'opened' | 'skipped' | 'remind_later' | 'completed'

export interface OnboardingResearchSurveyPreference {
  status: OnboardingResearchSurveyStatus
  promptedAt: string
  respondedAt?: string
  reminderAt?: string
}

export interface ProviderVotePreference {
  providerId: string
  providerName: string
  votedAt: string
  source?: string
}

// ── Templates & labels ────────────────────────────────────────────────────────

export const SECRET_TEMPLATES: Record<SecretType, SecretField[]> = {
  password:   [
    { key: 'Username', value: '', sensitive: false },
    { key: 'Password', value: '', sensitive: true  },
    { key: 'URL',      value: '', sensitive: false },
  ],
  apiKey:     [
    { key: 'Service', value: '', sensitive: false },
    { key: 'API Key', value: '', sensitive: true  },
    { key: 'Secret',  value: '', sensitive: true  },
  ],
  sshKey:     [
    { key: 'Public Key',  value: '', sensitive: false },
    { key: 'Private Key', value: '', sensitive: true  },
    { key: 'Passphrase',  value: '', sensitive: true  },
  ],
  secureNote: [{ key: 'Content',  value: '', sensitive: false }],
  custom:     [],
  image:      [{ key: '__image__', value: '', sensitive: true }],
}

export const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  password:   'Password',
  apiKey:     'API Key',
  sshKey:     'SSH Key',
  secureNote: 'Secure Note',
  custom:     'Custom',
  image:      'Image',
}

const OPEN_CORE_BUILD =
  typeof __VAULTAGE_OPEN_CORE__ !== 'undefined' && __VAULTAGE_OPEN_CORE__

export const PROVIDER_LABELS = (OPEN_CORE_BUILD ? {} : {
  doppler:    'Doppler',
  vercel:     'Vercel',
  cloudflare: 'Cloudflare',
  gitlab:     'GitLab',
  custom:     'Custom REST',
}) as Record<ProviderType, string>

export const SCOPE_PRESETS = ['production', 'staging', 'development', 'testing']
