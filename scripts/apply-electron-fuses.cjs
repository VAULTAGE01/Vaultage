const { join } = require('path')
const {
  flipFuses,
  FuseVersion,
  FuseV1Options,
} = require('@electron/fuses')

const fusePolicy = Object.freeze({
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // The renderer still loads from file://. Keep this compatibility fuse until
  // the app moves to a registered, least-privilege custom protocol.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  [FuseV1Options.WasmTrapHandlers]: true,
})

async function applyElectronFuses(context) {
  if (context.electronPlatformName !== 'darwin') {
    throw new Error(`Unsupported Electron fuse target: ${context.electronPlatformName}`)
  }
  // electron-builder creates two temporary thin apps before @electron/universal
  // merges them, then emits afterPack once more for the combined app. Flipping
  // a temporary slice would ad-hoc re-sign its complete bundle and make the two
  // architecture-specific CodeResources files fail the universal byte check.
  if (shouldSkipUniversalSlice(context.appOutDir)) return
  const productFilename = context.packager.appInfo.productFilename
  const executable = join(
    context.appOutDir,
    `${productFilename}.app`,
    'Contents',
    'MacOS',
    productFilename,
  )
  await flipFuses(executable, {
    ...fusePolicy,
    // afterPack runs before the final Developer ID signing pass. Reset the
    // invalidated ad-hoc signature so universal-build tooling can inspect the
    // modified binary safely before electron-builder applies the real one.
    resetAdHocDarwinSignature: context.arch !== undefined,
  })
}

function shouldSkipUniversalSlice(appOutDir) {
  return /-(?:x64|arm64)-temp$/u.test(appOutDir)
}

module.exports = applyElectronFuses
module.exports.fusePolicy = fusePolicy
module.exports.shouldSkipUniversalSlice = shouldSkipUniversalSlice
