import { existsSync, readdirSync, readFileSync } from 'fs'

const rules = [
  {
    name: 'portable main helpers do not import Electron or provider modules',
    files: ['src/main/security.ts', 'src/main/audit.ts'],
    forbidden: [/from ['"]electron['"]/, /from ['"]\.\/providers['"]/],
  },
  {
    name: 'provider implementation does not import Electron or vault storage',
    files: ['src/main/providers.ts', 'src/main/providerBasicOps.ts', 'src/main/providerLifecycleOps.ts'],
    forbidden: [/from ['"]electron['"]/, /from ['"]\.\/index['"]/, /from ['"]\.\/audit['"]/],
  },
  {
    name: 'main process no longer imports provider implementations directly',
    files: ['src/main/index.ts'],
    forbidden: [/from ['"]\.\/providers['"]/],
  },
  {
    name: 'provider IPC only talks to provider RPC, not implementations',
    files: ['src/main/providerIpc.ts', 'src/main/providerIpc.open.ts'],
    forbidden: [/from ['"]\.\/providers['"]/],
  },
  {
    name: 'provider IPC split keeps lifecycle automation out of basic/provider seams',
    files: ['src/main/providerIpc.open.ts'],
    forbidden: [
      /registerProviderLifecycleIpc/,
      /provider:delete-saved/,
      /provider:cf-permissions-saved/,
      /provider:cf-create-token-saved/,
      /provider:cf-roll-token-saved/,
      /cloudflare\.createToken/,
      /cloudflare\.rollToken/,
    ],
  },
  {
    name: 'saved provider IPC uses provider ids instead of renderer-supplied provider credentials',
    files: ['src/preload/index.ts', 'src/main/providerIpc.ts'],
    forbidden: [
      /provider:list['"]/,
      /provider:delete['"]/,
      /provider:cf-permissions['"]/,
      /provider:cf-create-token['"]/,
      /provider:cf-roll-token['"]/,
      /providerSet:\s*\(/,
      /providerList:\s*\([^)]*config:/s,
      /providerDelete:\s*\([^)]*config:/s,
      /cfPermissions:\s*\([^)]*token:/s,
      /cfCreateToken:\s*\([^)]*token:/s,
      /cfRollToken:\s*\([^)]*token:/s,
    ],
  },
  {
    name: 'saved image copies do not expose a generic renderer image clipboard bridge',
    files: ['src/preload/index.ts', 'src/main/platformIpc.ts'],
    forbidden: [
      /clipboard:writeImage/,
      /writeClipboardImage/,
    ],
  },
  {
    name: 'renderer does not expose a generic text clipboard bridge',
    files: ['src/preload/index.ts', 'src/main/platformIpc.ts', 'src/renderer/src/env.d.ts'],
    forbidden: [
      /clipboard:writeText/,
      /writeClipboardText/,
    ],
  },
  {
    name: 'renderer does not receive the raw Agent API token',
    files: ['src/preload/index.ts', 'src/renderer/src/env.d.ts', 'src/renderer/src/components/Sidebar.tsx'],
    forbidden: [
      /vault:agent-api-token/,
      /getAgentApiToken/,
    ],
  },
  {
    name: 'desktop renderer does not depend on react-three renderer packages',
    files: ['package.json'],
    forbidden: [
      /"@react-three\//,
    ],
  },
]

const requiredRules = [
  {
    name: 'native Keychain helper binds stored vault key to biometric access control',
    file: 'vault-keychain/main.swift',
    required: [
      /SecAccessControlCreateWithFlags/,
      /SecAccessControlCreateFlags\.userPresence/,
      /kSecAttrAccessControl/,
    ],
  },
  {
    name: 'audit chain uses a vault-key-derived HMAC',
    file: 'src/main/audit.ts',
    required: [
      /createHmac/,
      /hmac-sha256/,
      /deriveAuditMacKey/,
    ],
  },
  {
    name: 'provider RPC keeps Pro capability tiers explicit',
    file: 'src/main/providerRpc.ts',
    required: [
      /PROVIDER_BASIC_RPC_OPS/,
      /PROVIDER_LIFECYCLE_RPC_OPS/,
      /providerRpcOperationTier/,
    ],
  },
  {
    name: 'provider IPC keeps basic and lifecycle registration seams explicit',
    file: 'src/main/providerIpc.ts',
    required: [
      /registerProviderBasicIpc/,
      /registerProviderLifecycleIpc/,
      /providerAuditDetails/,
    ],
  },
  {
    name: 'packaged app update checks are wired conservatively',
    file: 'src/main/autoUpdate.ts',
    required: [
      /electron-updater/,
      /autoDownload\s*=\s*false/,
      /checkForUpdates/,
    ],
  },
  {
    name: 'release workflow uploads macOS updater metadata',
    file: '.github/workflows/release.yml',
    required: [
      /latest-mac\.yml/,
    ],
  },
  {
    name: 'unlocked vault snapshots are redacted before reaching the renderer',
    file: 'src/main/index.ts',
    required: [
      /redactVaultForRenderer/,
      /normalizeVaultData:\s*prepareVaultForRenderer/,
      /function prepareVaultForRenderer/,
    ],
  },
  {
    name: 'renderer vault saves preserve redacted secret values in main',
    file: 'src/main/vaultIpc.ts',
    required: [
      /mergeRedactedVaultValues/,
      /vault:reveal-secret-field/,
      /vault:reveal-secret-image-field/,
    ],
  },
  {
    name: 'saved provider credentials are redacted from renderer snapshots',
    file: 'src/main/vaultRedaction.ts',
    required: [
      /REDACTED_PROVIDER_CONFIG_VALUE/,
      /SENSITIVE_PROVIDER_CONFIG_KEY_RE/,
      /mergeProviderConfig/,
    ],
  },
  {
    name: 'saved secret reveal IPC requires fresh user presence',
    file: 'src/main/vaultIpc.ts',
    required: [
      /confirmSecretReveal/,
      /vault:reveal-secret-field/,
      /vault:reveal-secret-image-field/,
    ],
  },
  {
    name: 'Custom REST provider setup stays behind explicit advanced UI',
    file: 'src/renderer/src/components/AddProviderModal.tsx',
    skipIf: /OPEN_CORE_ADD_PROVIDER_STUB/,
    required: [
      /STANDARD_PROVIDER_TYPES/,
      /ADVANCED_PROVIDER_TYPES/,
      /showAdvancedProviders/,
      /VAULTAGE_CUSTOM_PROVIDER_HOSTS/,
    ],
  },
  {
    name: 'Agent HTTP API accepts only loopback socket peers',
    file: 'src/main/agentServer.ts',
    required: [
      /if \(!isLoopbackRemoteAddress\(remoteAddress\)\) return null/,
      /remoteAddress\s*=\s*req\.socket\.remoteAddress/,
      /server\.listen\(\{\s*port:\s*this\.port,\s*host:\s*this\.host,\s*exclusive:\s*true\s*\}\)/s,
    ],
  },
]

const generatedSourceAllowlist = new Set([
  'src/main/env.d.ts',
  'src/renderer/src/env.d.ts',
  'src/renderer/src/env.open.d.ts',
  'src/shared/dotenv.d.ts',
  'src/shared/dotenv.js',
])

function listFiles(dir) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...listFiles(file))
    } else if (entry.isFile()) {
      files.push(file)
    }
  }
  return files
}

let failed = false

for (const rule of rules) {
  for (const file of rule.files) {
    if (!existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    for (const pattern of rule.forbidden) {
      if (pattern.test(source)) {
        console.error(`Boundary violation: ${rule.name}`)
        console.error(`  ${file} matched ${pattern}`)
        failed = true
      }
    }
  }
}

for (const rule of requiredRules) {
  if (!existsSync(rule.file)) continue
  const source = readFileSync(rule.file, 'utf8')
  if (rule.skipIf?.test(source)) continue
  for (const pattern of rule.required) {
    if (!pattern.test(source)) {
      console.error(`Boundary violation: ${rule.name}`)
      console.error(`  ${rule.file} did not match required ${pattern}`)
      failed = true
    }
  }
}

if (existsSync('.github/workflows')) {
  for (const entry of readdirSync('.github/workflows', { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue
    const file = `.github/workflows/${entry.name}`
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/^\s*-\s*uses:\s+[^@\s]+@([^\s#]+)/gm)) {
      const ref = match[1]
      if (!/^[a-f0-9]{40}$/.test(ref)) {
        console.error('Boundary violation: workflow actions must be pinned to commit SHAs')
        console.error(`  ${file} uses non-SHA ref ${ref}`)
        failed = true
      }
    }
  }
}

for (const file of listFiles('src')) {
  if (!/\.(?:js|jsx|d\.ts)$/.test(file)) continue
  if (generatedSourceAllowlist.has(file)) continue
  console.error('Boundary violation: generated JavaScript/declaration artifacts must not live under src/')
  console.error(`  remove ${file} or add an intentional source allowlist entry`)
  failed = true
}

for (const file of ['electron.vite.config.js', 'electron.vite.config.d.ts']) {
  if (!existsSync(file) || !existsSync('electron.vite.config.ts')) continue
  console.error('Boundary violation: generated Electron Vite config output is shadowing the TypeScript source')
  console.error(`  remove ${file}`)
  failed = true
}

if (failed) process.exit(1)
console.log('Boundary checks passed.')
