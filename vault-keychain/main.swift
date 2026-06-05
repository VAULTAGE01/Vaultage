import Foundation
import Security
import LocalAuthentication
import Carbon

// Keychain coordinates. Keep legacy services readable across app renames.
let PRIMARY_SERVICE = "com.eden.vaultage.masterkey"
let LEGACY_SERVICES = ["dev.vault.app.masterkey"]
let MIGRATION_SERVICE = "com.eden.vaultage.masterkey.migration"
let READ_SERVICES = [PRIMARY_SERVICE] + LEGACY_SERVICES + [MIGRATION_SERVICE]
let ACCOUNT = "vault-key"

// Exit codes with distinct meanings so the caller can react appropriately
let EXIT_OK:       Int32 = 0
let EXIT_ERR:      Int32 = 1
let EXIT_CANCEL:   Int32 = 2  // user cancelled Touch ID
let EXIT_BADAUTH:  Int32 = 3  // local authentication failed
let EXIT_NOTFOUND: Int32 = 4  // no item in keychain (first run or wiped)
let ERR_MISSING_ENTITLEMENT: OSStatus = -34018

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

func replaceStoredKey(_ keyData: Data) -> OSStatus {
    _ = deleteKey(service: MIGRATION_SERVICE)

    let migrationStatus = addKey(keyData, service: MIGRATION_SERVICE)
    guard migrationStatus == errSecSuccess else {
        return migrationStatus
    }

    for service in [PRIMARY_SERVICE] + LEGACY_SERVICES {
        _ = deleteKey(service: service)
    }

    let primaryStatus = addKey(keyData, service: PRIMARY_SERVICE)
    guard primaryStatus == errSecSuccess else {
        fputs("vault-keychain: primary Keychain rewrite failed: \(primaryStatus)\n", stderr)
        return primaryStatus
    }

    _ = deleteKey(service: MIGRATION_SERVICE)
    return errSecSuccess
}

func storeKey(_ hexKey: String) -> Int32 {
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

func retrieveKey(prompt: String) -> Int32 {
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
    fputs("usage: vault-keychain <store|retrieve|remove|secure-input> [args...]\n", stderr)
    exit(EXIT_ERR)
}

switch args[1] {
case "store":
    guard args.count >= 3 else {
        fputs("usage: vault-keychain store <hex-key>\n", stderr)
        exit(EXIT_ERR)
    }
    exit(storeKey(args[2]))

case "retrieve":
    let prompt = args.count >= 3 ? args[2] : "unlock Vaultage"
    exit(retrieveKey(prompt: prompt))

case "remove":
    exit(removeKey())

case "secure-input":
    guard args.count >= 3 else {
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
