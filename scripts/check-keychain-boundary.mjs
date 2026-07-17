import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'

if (process.platform !== 'darwin') {
  console.log('Native Keychain caller boundary check skipped on non-darwin platform.')
  process.exit(0)
}

const root = process.cwd()
const build = spawnSync('bash', ['build-helper.sh'], {
  cwd: root,
  encoding: 'utf8',
})
if (build.status !== 0) {
  console.error(build.stdout)
  console.error(build.stderr)
  process.exit(build.status ?? 1)
}

const helper = join(root, 'resources', 'vault-keychain')
const electron = join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
const harness = join(root, 'scripts', 'keychain-caller-harness.cjs')
if (!existsSync(helper)) {
  console.error(`Missing Keychain boundary test dependency: ${helper}`)
  process.exit(1)
}

// Edition coordinates are one coherent tuple. In particular, Community may
// never opt into a closed legacy or transaction namespace, even if a modified
// caller controls the helper environment.
for (const environment of [
  {
    VAULTAGE_KEYCHAIN_SERVICE: 'xyz.arcalab.vault-oc.masterkey',
    VAULTAGE_KEYCHAIN_LEGACY_SERVICES: 'com.eden.vaultage.masterkey',
    VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: 'xyz.arcalab.vault-oc.masterkey.migration',
  },
  {
    VAULTAGE_KEYCHAIN_SERVICE: 'xyz.arcalab.vault-oc.masterkey',
    VAULTAGE_KEYCHAIN_LEGACY_SERVICES: '',
    VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: 'xyz.arcalab.vaultage.masterkey.migration',
  },
]) {
  const mixedEdition = spawnSync(helper, ['verify-caller'], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...environment },
    timeout: 5_000,
  })
  if (mixedEdition.status !== 1 || !mixedEdition.stderr.includes('unsupported')) {
    console.error('Native helper accepted mixed Community/closed Keychain coordinates', {
      status: mixedEdition.status,
      stderr: mixedEdition.stderr.trim(),
    })
    process.exit(1)
  }
}

// A normal shell/Node process must not be able to invoke even the no-secret
// identity probe. Sensitive commands run behind the same check.
const unauthorized = spawnSync(helper, ['verify-caller'], {
  encoding: 'utf8',
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  timeout: 5_000,
})
if (unauthorized.status !== 5 || !unauthorized.stderr.includes('caller identity verification failed')) {
  console.error('Native helper did not fail closed for an unauthorized parent', {
    status: unauthorized.status,
    signal: unauthorized.signal,
    stdout: unauthorized.stdout.trim(),
    stderr: unauthorized.stderr.trim(),
  })
  process.exit(1)
}

if (existsSync(electron) && existsSync(harness)) {
  const copiedHelperDirectory = mkdtempSync(join(tmpdir(), 'vaultage-keychain-copy-'))
  const copiedHelper = join(copiedHelperDirectory, 'copied-helper')
  copyFileSync(helper, copiedHelper)

  const authorized = spawnSync(electron, [harness], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      VAULTAGE_KEYCHAIN_SMOKE_ROOT: root,
      VAULTAGE_KEYCHAIN_SMOKE_COPY: copiedHelper,
    },
    timeout: 15_000,
  })
  rmSync(copiedHelperDirectory, { recursive: true, force: true })
  if (authorized.status !== 0) {
    console.error('Native helper rejected the expected Electron development caller', {
      status: authorized.status,
      signal: authorized.signal,
      stdout: authorized.stdout.trim(),
      stderr: authorized.stderr.trim(),
    })
    process.exit(1)
  }
}

// Exercise the packaged ad-hoc branch with a sealed synthetic app. This does
// not claim production trust; it proves the helper checks the whole containing
// bundle rather than accepting a valid main executable after signed resources
// have been modified.
const bundleFixtureDirectory = mkdtempSync(join(tmpdir(), 'vaultage-keychain-app-'))
const appFixture = join(bundleFixtureDirectory, 'Vaultage.app')
const fixtureContents = join(appFixture, 'Contents')
const fixtureMacOS = join(fixtureContents, 'MacOS')
const fixtureResources = join(fixtureContents, 'Resources')
const fixtureMain = join(fixtureMacOS, 'Vaultage')
const fixtureHelper = join(fixtureResources, 'Vaultage Keychain')
const fixtureMarker = join(fixtureResources, 'sealed-resource.txt')
const fixtureInfo = join(fixtureContents, 'Info.plist')
const fixtureLauncherSource = join(bundleFixtureDirectory, 'launcher.c')
mkdirSync(fixtureMacOS, { recursive: true })
mkdirSync(fixtureResources, { recursive: true })
copyFileSync(helper, fixtureHelper)
writeFileSync(fixtureMarker, 'sealed\n')
chmodSync(fixtureHelper, 0o755)
writeFileSync(fixtureLauncherSource, `
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>

extern char **environ;

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  pid_t child = 0;
  char *child_argv[] = { argv[1], "verify-caller", NULL };
  int spawn_status = posix_spawn(&child, argv[1], NULL, NULL, child_argv, environ);
  if (spawn_status != 0) {
    fprintf(stderr, "fixture launcher could not start helper (%d)\\n", spawn_status);
    return 70;
  }
  int status = 0;
  if (waitpid(child, &status, 0) < 0) return 71;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 72;
}
`)
const compileLauncher = spawnSync(
  '/usr/bin/clang',
  [fixtureLauncherSource, '-o', fixtureMain],
  { encoding: 'utf8', timeout: 30_000 },
)
if (compileLauncher.status !== 0) {
  rmSync(bundleFixtureDirectory, { recursive: true, force: true })
  console.error('Could not compile packaged Keychain boundary fixture', compileLauncher.stderr.trim())
  process.exit(1)
}
writeFileSync(fixtureInfo, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>xyz.arcalab.vaultage</string>
<key>CFBundleExecutable</key><string>Vaultage</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`)

const sign = (target, identifier, deep = false) => spawnSync(
  '/usr/bin/codesign',
  [
    '--force',
    ...(deep ? ['--deep'] : []),
    '--sign', '-',
    '--identifier', identifier,
    '--options', 'runtime',
    '--timestamp=none',
    target,
  ],
  { encoding: 'utf8', timeout: 10_000 },
)
for (const signed of [
  sign(fixtureHelper, 'xyz.arcalab.vaultage.keychain-helper'),
  sign(fixtureMain, 'xyz.arcalab.vaultage'),
  sign(appFixture, 'xyz.arcalab.vaultage', true),
]) {
  if (signed.status !== 0) {
    rmSync(bundleFixtureDirectory, { recursive: true, force: true })
    console.error('Could not sign packaged Keychain boundary fixture', signed.stderr.trim())
    process.exit(1)
  }
}

const fixtureEnvironment = {
  VAULTAGE_KEYCHAIN_SERVICE: 'xyz.arcalab.vaultage.masterkey',
  VAULTAGE_KEYCHAIN_LEGACY_SERVICES: 'com.eden.vaultage.masterkey,com.eden.vaultage.masterkey.migration,dev.vault.app.masterkey',
  VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: 'xyz.arcalab.vaultage.masterkey.migration',
}
const runFixture = () => spawnSync(
  fixtureMain,
  [fixtureHelper],
  // The first Security.framework validity evaluation on a cold hosted macOS
  // runner can exceed ten seconds. Keep a hard ceiling, but do not turn that
  // one-time trust-cache cost into a false policy rejection.
  { encoding: 'utf8', env: fixtureEnvironment, timeout: 30_000 },
)
const sealedFixture = runFixture()
if (sealedFixture.status !== 0 || sealedFixture.stdout.trim() !== 'vaultage-keychain-caller-v1') {
  const mainDescription = spawnSync('/usr/bin/codesign', ['-dvvv', fixtureMain], { encoding: 'utf8' })
  rmSync(bundleFixtureDirectory, { recursive: true, force: true })
  console.error('Native helper rejected a valid sealed ad-hoc app fixture', {
    status: sealedFixture.status,
    signal: sealedFixture.signal,
    stderr: sealedFixture.stderr.trim(),
    mainSignature: `${mainDescription.stdout}\n${mainDescription.stderr}`.trim(),
  })
  process.exit(1)
}

appendFileSync(fixtureMarker, 'post-signature tamper\n')
const tamperedFixture = runFixture()
rmSync(bundleFixtureDirectory, { recursive: true, force: true })
if (tamperedFixture.status !== 5 || !tamperedFixture.stderr.includes('resource seal is invalid')) {
  console.error('Native helper did not reject a modified containing app bundle', {
    status: tamperedFixture.status,
    stdout: tamperedFixture.stdout.trim(),
    stderr: tamperedFixture.stderr.trim(),
  })
  process.exit(1)
}

console.log('Native Keychain caller boundary check passed.')
