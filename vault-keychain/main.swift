import Foundation
import Security
import LocalAuthentication
import Carbon
import Darwin

// Keychain coordinates. The closed app and open app can be installed side by
// side. The Electron parent selects one of these fixed edition namespaces;
// arbitrary service names are rejected so this helper cannot be repurposed as
// a generic Keychain read/delete primitive.
let DEFAULT_PRIMARY_SERVICE = "xyz.arcalab.vaultage.masterkey"
let COMMUNITY_PRIMARY_SERVICE = "xyz.arcalab.vault-oc.masterkey"
// These namespaces were used only by unreleased developer builds. They remain
// read/delete-only migration inputs so existing local vaults survive the
// official ownership cutover without preserving a second production identity.
let DEFAULT_LEGACY_SERVICES = [
    "com.eden.vaultage.masterkey",
    "com.eden.vaultage.masterkey.migration",
    "dev.vault.app.masterkey",
]
let DEFAULT_MIGRATION_SERVICE = "xyz.arcalab.vaultage.masterkey.migration"
let COMMUNITY_MIGRATION_SERVICE = "xyz.arcalab.vault-oc.masterkey.migration"

func validatedService(_ environmentName: String, fallback: String, allowed: Set<String>) -> String {
    let candidate = ProcessInfo.processInfo.environment[environmentName] ?? fallback
    guard allowed.contains(candidate) else {
        fputs("vault-keychain: rejected unsupported Keychain service namespace\n", stderr)
        exit(1)
    }
    return candidate
}

func validatedLegacyServices(primaryService: String) -> [String] {
    let allowed = primaryService == COMMUNITY_PRIMARY_SERVICE ? [] : DEFAULT_LEGACY_SERVICES
    guard let raw = ProcessInfo.processInfo.environment["VAULTAGE_KEYCHAIN_LEGACY_SERVICES"] else {
        return allowed
    }
    let candidates = raw
        .split(separator: ",")
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    guard candidates.allSatisfy({ allowed.contains($0) }) else {
        fputs("vault-keychain: rejected unsupported legacy Keychain service namespace\n", stderr)
        exit(1)
    }
    return candidates
}

func validatedMigrationService(primaryService: String) -> String {
    let expected = primaryService == COMMUNITY_PRIMARY_SERVICE
        ? COMMUNITY_MIGRATION_SERVICE
        : DEFAULT_MIGRATION_SERVICE
    return validatedService(
        "VAULTAGE_KEYCHAIN_MIGRATION_SERVICE",
        fallback: expected,
        allowed: [expected]
    )
}

let PRIMARY_SERVICE = validatedService(
    "VAULTAGE_KEYCHAIN_SERVICE",
    fallback: DEFAULT_PRIMARY_SERVICE,
    allowed: [DEFAULT_PRIMARY_SERVICE, COMMUNITY_PRIMARY_SERVICE]
)
let LEGACY_SERVICES = validatedLegacyServices(primaryService: PRIMARY_SERVICE)
let MIGRATION_SERVICE = validatedMigrationService(primaryService: PRIMARY_SERVICE)
let READ_SERVICES: [String] = {
    var services = [PRIMARY_SERVICE]
    for service in LEGACY_SERVICES {
        services.append(service)
    }
    if !MIGRATION_SERVICE.isEmpty {
        services.append(MIGRATION_SERVICE)
    }
    return services
}()
let ACCOUNT = "vault-key"

// Exit codes with distinct meanings so the caller can react appropriately
let EXIT_OK:       Int32 = 0
let EXIT_ERR:      Int32 = 1
let EXIT_CANCEL:   Int32 = 2  // user cancelled Touch ID
let EXIT_BADAUTH:  Int32 = 3  // local authentication failed
let EXIT_NOTFOUND: Int32 = 4  // no item in keychain (first run or wiped)
let EXIT_UNAUTHORIZED: Int32 = 5 // caller is not the containing Vaultage app
let ERR_MISSING_ENTITLEMENT: OSStatus = -34018

// Code-signing flags from <Security/SecCode.h>. Swift imports the validation
// APIs but not symbolic names for every CodeDirectory bit.
let CODE_SIGNATURE_ADHOC: UInt32 = 0x00000002
let CODE_SIGNATURE_RUNTIME: UInt32 = 0x00010000

struct CodeIdentity {
    let code: SecCode
    let identifier: String
    let teamIdentifier: String?
    let executableURL: URL
    let flags: UInt32
}

func normalizedURL(_ url: URL) -> URL {
    return url.standardizedFileURL.resolvingSymlinksInPath()
}

func signingIdentity(for code: SecCode, label: String) -> CodeIdentity? {
    let validityFlags = SecCSFlags(rawValue: kSecCSStrictValidate)
    let validityStatus = SecCodeCheckValidity(code, validityFlags, nil)
    guard validityStatus == errSecSuccess else {
        fputs("vault-keychain: \(label) code signature is invalid (\(validityStatus))\n", stderr)
        return nil
    }

    var staticCode: SecStaticCode?
    let staticStatus = SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode)
    guard staticStatus == errSecSuccess, let staticCode else {
        fputs("vault-keychain: could not inspect \(label) static code identity (\(staticStatus))\n", stderr)
        return nil
    }

    var signingInformation: CFDictionary?
    let infoStatus = SecCodeCopySigningInformation(
        staticCode,
        SecCSFlags(rawValue: kSecCSSigningInformation),
        &signingInformation
    )
    guard infoStatus == errSecSuccess,
          let information = signingInformation as NSDictionary?,
          let identifier = information[kSecCodeInfoIdentifier] as? String,
          let executableURL = information[kSecCodeInfoMainExecutable] as? URL,
          let flagsNumber = information[kSecCodeInfoFlags] as? NSNumber
    else {
        fputs("vault-keychain: could not inspect \(label) code identity (\(infoStatus))\n", stderr)
        return nil
    }

    return CodeIdentity(
        code: code,
        identifier: identifier,
        teamIdentifier: information[kSecCodeInfoTeamIdentifier] as? String,
        executableURL: normalizedURL(executableURL),
        flags: flagsNumber.uint32Value
    )
}

func currentProcessIdentity() -> CodeIdentity? {
    var code: SecCode?
    let status = SecCodeCopySelf(SecCSFlags(), &code)
    guard status == errSecSuccess, let code else {
        fputs("vault-keychain: could not inspect helper code identity (\(status))\n", stderr)
        return nil
    }
    return signingIdentity(for: code, label: "helper")
}

func parentProcessIdentity() -> CodeIdentity? {
    let parentPID = getppid()
    guard parentPID > 1 else {
        fputs("vault-keychain: invalid parent process\n", stderr)
        return nil
    }

    let attributes = [kSecGuestAttributePid: NSNumber(value: parentPID)] as CFDictionary
    var code: SecCode?
    let status = SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &code)
    guard status == errSecSuccess, let code else {
        fputs("vault-keychain: could not inspect parent code identity (\(status))\n", stderr)
        return nil
    }
    return signingIdentity(for: code, label: "parent")
}

func packagedAppRoot(for helperURL: URL) -> URL? {
    let resourcesURL = helperURL.deletingLastPathComponent()
    guard resourcesURL.lastPathComponent == "Resources" else { return nil }
    let contentsURL = resourcesURL.deletingLastPathComponent()
    guard contentsURL.lastPathComponent == "Contents" else { return nil }
    let appURL = contentsURL.deletingLastPathComponent()
    guard appURL.pathExtension.lowercased() == "app" else { return nil }
    return normalizedURL(appURL)
}

func isExpectedPackagedParent(_ parent: CodeIdentity, helper: CodeIdentity, appRoot: URL) -> Bool {
    let expectedIdentifier = PRIMARY_SERVICE == COMMUNITY_PRIMARY_SERVICE
        ? "xyz.arcalab.vault-oc"
        : "xyz.arcalab.vaultage"
    guard parent.identifier == expectedIdentifier else {
        fputs("vault-keychain: rejected unexpected parent bundle identifier '\(parent.identifier)'\n", stderr)
        return false
    }

    let macOSDirectory = normalizedURL(appRoot
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("MacOS", isDirectory: true))
    guard parent.executableURL.deletingLastPathComponent() == macOSDirectory else {
        fputs("vault-keychain: parent executable is outside the containing app\n", stderr)
        return false
    }

    let expectedResourcesDirectory = normalizedURL(appRoot
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("Resources", isDirectory: true))
    guard helper.executableURL.deletingLastPathComponent() == expectedResourcesDirectory else {
        fputs("vault-keychain: helper executable is outside the containing app\n", stderr)
        return false
    }
    return true
}

func validateContainingAppSignature(at appRoot: URL, requirement: SecRequirement?) -> Bool {
    var staticCode: SecStaticCode?
    let createStatus = SecStaticCodeCreateWithPath(appRoot as CFURL, SecCSFlags(), &staticCode)
    guard createStatus == errSecSuccess, let staticCode else {
        fputs("vault-keychain: could not inspect containing app signature\n", stderr)
        return false
    }
    let flags = SecCSFlags(rawValue:
        kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode
    )
    let status = SecStaticCodeCheckValidity(staticCode, flags, requirement)
    guard status == errSecSuccess else {
        fputs("vault-keychain: containing app signature or resource seal is invalid (\(status))\n", stderr)
        return false
    }
    return true
}

func validateDeveloperIDIdentity(helper: CodeIdentity, parent: CodeIdentity, appRoot: URL) -> Bool {
    guard let helperTeam = helper.teamIdentifier,
          let parentTeam = parent.teamIdentifier,
          !helperTeam.isEmpty,
          helperTeam == parentTeam,
          helperTeam.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil
    else {
        fputs("vault-keychain: helper and parent signing teams do not match\n", stderr)
        return false
    }
    guard helper.flags & CODE_SIGNATURE_RUNTIME != 0,
          parent.flags & CODE_SIGNATURE_RUNTIME != 0
    else {
        fputs("vault-keychain: signed helper boundary requires hardened runtime\n", stderr)
        return false
    }
    guard isExpectedPackagedParent(parent, helper: helper, appRoot: appRoot) else {
        return false
    }

    // The team identifier is read from this already-validated helper, then used
    // in an Apple-anchored Developer ID requirement for both processes. This
    // prevents an ad-hoc or self-signed executable from copying the helper and
    // impersonating the app with the same bundle identifier.
    let requirementText = "anchor apple generic and certificate leaf[subject.OU] = \"\(helperTeam)\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
    var requirement: SecRequirement?
    let requirementStatus = SecRequirementCreateWithString(
        requirementText as CFString,
        SecCSFlags(),
        &requirement
    )
    guard requirementStatus == errSecSuccess, let requirement else {
        fputs("vault-keychain: could not construct caller signing requirement\n", stderr)
        return false
    }

    let validationFlags = SecCSFlags(rawValue: kSecCSStrictValidate)
    let helperStatus = SecCodeCheckValidity(helper.code, validationFlags, requirement)
    let parentStatus = SecCodeCheckValidity(parent.code, validationFlags, requirement)
    guard helperStatus == errSecSuccess, parentStatus == errSecSuccess else {
        fputs("vault-keychain: caller does not satisfy the Developer ID requirement\n", stderr)
        return false
    }
    guard validateContainingAppSignature(at: appRoot, requirement: requirement) else {
        return false
    }
    return true
}

func validateAdHocDevelopmentIdentity(helper: CodeIdentity, parent: CodeIdentity, appRoot: URL?) -> Bool {
    guard helper.teamIdentifier == nil,
          parent.teamIdentifier == nil,
          helper.flags & CODE_SIGNATURE_ADHOC != 0,
          parent.flags & CODE_SIGNATURE_ADHOC != 0
    else {
        return false
    }

    if let appRoot {
        // Local Community packaging uses an ad-hoc signature. It still gets
        // strict path, identifier, and signature-integrity checks, but cannot
        // provide the Apple-anchored team guarantee of a production build.
        return isExpectedPackagedParent(parent, helper: helper, appRoot: appRoot)
            && validateContainingAppSignature(at: appRoot, requirement: nil)
    }

    guard let rawDevelopmentRoot = ProcessInfo.processInfo.environment["VAULTAGE_KEYCHAIN_DEV_ROOT"],
          !rawDevelopmentRoot.isEmpty
    else {
        return false
    }
    let developmentRoot = normalizedURL(URL(fileURLWithPath: rawDevelopmentRoot, isDirectory: true))
    let expectedHelper = normalizedURL(developmentRoot
        .appendingPathComponent("resources", isDirectory: true)
        .appendingPathComponent("vault-keychain", isDirectory: false))
    guard helper.executableURL == expectedHelper,
          parent.identifier == "Electron"
    else {
        return false
    }

    let nodeModules = normalizedURL(developmentRoot.appendingPathComponent("node_modules", isDirectory: true))
    let parentPath = parent.executableURL.path
    let expectedPrefix = nodeModules.path.hasSuffix("/") ? nodeModules.path : nodeModules.path + "/"
    guard parentPath.hasPrefix(expectedPrefix),
          parentPath.hasSuffix("/Electron.app/Contents/MacOS/Electron")
    else {
        return false
    }
    return true
}

func verifyCallerIdentity() -> Bool {
    guard let helper = currentProcessIdentity(),
          let parent = parentProcessIdentity()
    else {
        return false
    }
    let appRoot = packagedAppRoot(for: helper.executableURL)
    if helper.teamIdentifier != nil || parent.teamIdentifier != nil {
        guard let appRoot else {
            fputs("vault-keychain: signed helper must run inside its app bundle\n", stderr)
            return false
        }
        return validateDeveloperIDIdentity(helper: helper, parent: parent, appRoot: appRoot)
    }

    let allowed = validateAdHocDevelopmentIdentity(helper: helper, parent: parent, appRoot: appRoot)
    if !allowed {
        fputs("vault-keychain: rejected unauthorized ad-hoc caller\n", stderr)
    }
    return allowed
}

// ── store ─────────────────────────────────────────────────────────────────────
// Writes `hexKey` into the local Keychain.
// kSecAccessControlUserPresence: Keychain refuses to release the item until
// macOS verifies local user presence with Touch ID or the Mac password.
// WhenUnlockedThisDeviceOnly keeps it on this Mac.

func makeUserPresenceAccessControl() -> SecAccessControl? {
    var error: Unmanaged<CFError>?
    guard let accessControl = SecAccessControlCreateWithFlags(
        nil,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        SecAccessControlCreateFlags.userPresence,
        &error
    ) else {
        let message = error?.takeRetainedValue().localizedDescription ?? "unknown error"
        fputs("vault-keychain: SecAccessControlCreateWithFlags failed: \(message)\n", stderr)
        return nil
    }
    return accessControl
}

func deleteKey(service: String) -> OSStatus {
    let query: [CFString: Any] = [
        kSecClass:       kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: ACCOUNT,
    ]
    return SecItemDelete(query as CFDictionary)
}

func keyExists(service: String) -> OSStatus {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: ACCOUNT,
        kSecReturnAttributes: kCFBooleanTrue as Any,
        kSecMatchLimit: kSecMatchLimitOne,
    ]
    return SecItemCopyMatching(query as CFDictionary, nil)
}

func deleteKeyAndRequireAbsent(service: String) -> OSStatus {
    let deleteStatus = deleteKey(service: service)
    guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
        return deleteStatus
    }
    let existsStatus = keyExists(service: service)
    if existsStatus == errSecItemNotFound {
        return errSecSuccess
    }
    // SecItemCopyMatching returning success means the supposedly deleted item
    // still exists (for example, after a concurrent recreation). Never map
    // that status to transaction success or remove the recovery marker.
    if existsStatus == errSecSuccess {
        return errSecDuplicateItem
    }
    return existsStatus
}

func addProtectedKey(_ keyData: Data, service: String) -> OSStatus {
    guard let accessControl = makeUserPresenceAccessControl() else {
        return errSecParam
    }

    let add: [CFString: Any] = [
        kSecClass:             kSecClassGenericPassword,
        kSecAttrService:       service,
        kSecAttrAccount:       ACCOUNT,
        kSecValueData:         keyData,
        kSecAttrAccessControl: accessControl,
        kSecAttrSynchronizable: kCFBooleanFalse as Any,
    ]
    return SecItemAdd(add as CFDictionary, nil)
}

func addDeviceOnlyKey(_ keyData: Data, service: String) -> OSStatus {
    let add: [CFString: Any] = [
        kSecClass:             kSecClassGenericPassword,
        kSecAttrService:       service,
        kSecAttrAccount:       ACCOUNT,
        kSecValueData:         keyData,
        kSecAttrAccessible:    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAttrSynchronizable: kCFBooleanFalse as Any,
    ]
    return SecItemAdd(add as CFDictionary, nil)
}

func addKey(_ keyData: Data, service: String) -> OSStatus {
    let protectedStatus = addProtectedKey(keyData, service: service)
    if protectedStatus == errSecSuccess {
        return protectedStatus
    }

    if protectedStatus == ERR_MISSING_ENTITLEMENT {
        // Local ad-hoc builds cannot create access-control protected items.
        // Retrieval still requires LAContext user presence before reading.
        return addDeviceOnlyKey(keyData, service: service)
    }

    return protectedStatus
}

func stageMigrationKey(_ keyData: Data) -> OSStatus {
    let addStatus = addKey(keyData, service: MIGRATION_SERVICE)
    if addStatus != errSecDuplicateItem {
        return addStatus
    }
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: MIGRATION_SERVICE,
        kSecAttrAccount: ACCOUNT,
    ]
    return SecItemUpdate(query as CFDictionary, [kSecValueData: keyData] as CFDictionary)
}

func replaceStoredKey(_ keyData: Data) -> OSStatus {
    // Stage or atomically update the recovery copy before deleting any source.
    // A crash or retry therefore always leaves at least one complete key.
    let migrationStatus = stageMigrationKey(keyData)
    guard migrationStatus == errSecSuccess else {
        return migrationStatus
    }

    for service in [PRIMARY_SERVICE] + LEGACY_SERVICES {
        let deletionStatus = deleteKeyAndRequireAbsent(service: service)
        guard deletionStatus == errSecSuccess else {
            fputs("vault-keychain: legacy Keychain deletion failed: \(deletionStatus)\n", stderr)
            return deletionStatus
        }
    }

    let primaryStatus = addKey(keyData, service: PRIMARY_SERVICE)
    guard primaryStatus == errSecSuccess else {
        fputs("vault-keychain: primary Keychain rewrite failed: \(primaryStatus)\n", stderr)
        return primaryStatus
    }

    // Remove the recovery marker only after every retired namespace is proven
    // absent and the new primary write has succeeded.
    return deleteKeyAndRequireAbsent(service: MIGRATION_SERVICE)
}

func storeKey(_ hexKey: String) -> Int32 {
    guard hexKey.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil else {
        fputs("vault-keychain: key must be exactly 32 bytes of hexadecimal data\n", stderr)
        return EXIT_ERR
    }
    guard let keyData = hexKey.data(using: .utf8) else {
        fputs("vault-keychain: invalid hex data\n", stderr)
        return EXIT_ERR
    }

    let status = replaceStoredKey(keyData)
    guard status == errSecSuccess else {
        fputs("vault-keychain: SecItemAdd failed: \(status)\n", stderr)
        return EXIT_ERR
    }
    return EXIT_OK
}

// ── retrieve ──────────────────────────────────────────────────────────────────
// Reads the key from Keychain using a user-presence LAContext. The manual prompt
// keeps legacy, pre-access-control items gated; the Keychain access-control
// policy independently gates newly stored items.
// Prints the hex key to stdout on success (no trailing newline).

func retrieveKey() -> Int32 {
    let appName = PRIMARY_SERVICE == COMMUNITY_PRIMARY_SERVICE ? "Vaultage Community Edition" : "Vaultage"
    let prompt = "unlock \(appName)"
    var foundService: String?
    var shouldRefreshProtectedItem = false
    for service in READ_SERVICES {
        let existsQuery: [CFString: Any] = [
            kSecClass:           kSecClassGenericPassword,
            kSecAttrService:     service,
            kSecAttrAccount:     ACCOUNT,
            kSecReturnAttributes: kCFBooleanTrue as Any,
            kSecMatchLimit:      kSecMatchLimitOne,
        ]

        var attrs: AnyObject?
        let existsStatus = SecItemCopyMatching(existsQuery as CFDictionary, &attrs)
        if existsStatus == errSecSuccess {
            foundService = service
            if service != PRIMARY_SERVICE {
                shouldRefreshProtectedItem = true
            } else if keyExists(service: MIGRATION_SERVICE) == errSecSuccess {
                // Complete cleanup after a crash that occurred after the
                // primary write but before transaction-marker removal.
                shouldRefreshProtectedItem = true
            }
            break
        }
        if existsStatus != errSecItemNotFound {
            fputs("vault-keychain: SecItemCopyMatching attributes failed: \(existsStatus)\n", stderr)
            return EXIT_ERR
        }
    }

    guard let service = foundService else {
        return EXIT_NOTFOUND
    }

    let context = LAContext()
    context.localizedReason = prompt
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
        fputs("vault-keychain: local authentication unavailable: \(authError?.localizedDescription ?? "?")\n", stderr)
        return EXIT_NOTFOUND
    }

    let semaphore = DispatchSemaphore(value: 0)
    var authSucceeded = false
    var authFailure: Error?
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: prompt) { success, error in
        authSucceeded = success
        authFailure = error
        semaphore.signal()
    }
    semaphore.wait()

    if !authSucceeded {
        let nsError = authFailure as NSError?
        switch nsError?.code {
        case LAError.userCancel.rawValue, LAError.appCancel.rawValue, LAError.systemCancel.rawValue:
            return EXIT_CANCEL
        default:
            return EXIT_BADAUTH
        }
    }

    let query: [CFString: Any] = [
        kSecClass:      kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: ACCOUNT,
        kSecReturnData: kCFBooleanTrue as Any,
        kSecMatchLimit: kSecMatchLimitOne,
        kSecUseAuthenticationContext: context,
    ]

    var item: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    switch status {
    case errSecSuccess:
        guard let data = item as? Data,
              let hex  = String(data: data, encoding: .utf8)
        else {
            fputs("vault-keychain: corrupt keychain item\n", stderr)
            return EXIT_ERR
        }
        if shouldRefreshProtectedItem {
            let refreshStatus = replaceStoredKey(data)
            if refreshStatus != errSecSuccess {
                fputs("vault-keychain: protected Keychain refresh failed: \(refreshStatus)\n", stderr)
            }
        }
        print(hex, terminator: "")
        fflush(stdout)
        return EXIT_OK
    case errSecItemNotFound:
        return EXIT_NOTFOUND
    default:
        fputs("vault-keychain: SecItemCopyMatching failed: \(status)\n", stderr)
        return EXIT_ERR
    }
}

// ── remove ────────────────────────────────────────────────────────────────────

func removeKey() -> Int32 {
    for service in READ_SERVICES {
        let status = deleteKey(service: service)
        if status != errSecSuccess && status != errSecItemNotFound {
            fputs("vault-keychain: SecItemDelete failed: \(status)\n", stderr)
            return EXIT_ERR
        }
    }
    return EXIT_OK
}

// ── secure event input ────────────────────────────────────────────────────────
// Holds macOS Secure Event Input while this helper process is alive. The
// Electron main process starts this command when a protected password field is
// focused and closes stdin when focus leaves.

func holdSecureEventInput() -> Int32 {
    EnableSecureEventInput()
    guard IsSecureEventInputEnabled() else {
        fputs("vault-keychain: Secure Event Input did not enable\n", stderr)
        return EXIT_ERR
    }
    print("ready", terminator: "\n")
    fflush(stdout)

    while let line = readLine() {
        let command = line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if command == "disable" || command == "stop" || command == "exit" {
            break
        }
    }

    DisableSecureEventInput()
    return EXIT_OK
}

// ── entry point ───────────────────────────────────────────────────────────────

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("usage: vault-keychain <verify-caller|store|retrieve|remove|secure-input> [args...]\n", stderr)
    exit(EXIT_ERR)
}

guard verifyCallerIdentity() else {
    fputs("vault-keychain: caller identity verification failed\n", stderr)
    exit(EXIT_UNAUTHORIZED)
}

switch args[1] {
case "verify-caller":
    guard args.count == 2 else {
        fputs("usage: vault-keychain verify-caller\n", stderr)
        exit(EXIT_ERR)
    }
    print("vaultage-keychain-caller-v1", terminator: "\n")
    fflush(stdout)
    exit(EXIT_OK)

case "store":
    guard args.count == 2 else {
        fputs("usage: send the key on stdin: vault-keychain store\n", stderr)
        exit(EXIT_ERR)
    }
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 128,
          let hexKey = String(data: input, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    else {
        fputs("vault-keychain: invalid key input\n", stderr)
        exit(EXIT_ERR)
    }
    exit(storeKey(hexKey))

case "retrieve":
    guard args.count == 2 else {
        fputs("usage: vault-keychain retrieve\n", stderr)
        exit(EXIT_ERR)
    }
    exit(retrieveKey())

case "remove":
    guard args.count == 2 else {
        fputs("usage: vault-keychain remove\n", stderr)
        exit(EXIT_ERR)
    }
    exit(removeKey())

case "secure-input":
    guard args.count == 3 else {
        fputs("usage: vault-keychain secure-input <hold>\n", stderr)
        exit(EXIT_ERR)
    }
    switch args[2] {
    case "hold":
        exit(holdSecureEventInput())
    default:
        fputs("vault-keychain: unknown secure-input command '\(args[2])'\n", stderr)
        exit(EXIT_ERR)
    }

default:
    fputs("vault-keychain: unknown command '\(args[1])'\n", stderr)
    exit(EXIT_ERR)
}
