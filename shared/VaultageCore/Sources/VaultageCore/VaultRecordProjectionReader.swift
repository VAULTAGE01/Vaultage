import CoreFoundation
import CryptoKit
import Foundation

public enum VaultRecordProjectionReader {
    public static func projectCredentialList(
        encryptedCollection: Data,
        collectionKey: Data,
        vaultID: String,
        loadRecordBlob: @escaping (String) throws -> Data
    ) throws -> CredentialListProjection {
        let collection = try VaultCollectionReader.validatedCollection(
            encryptedCollection: encryptedCollection,
            collectionKey: collectionKey
        )
        guard let entry = collection.entries.first(where: { $0.projection.id == vaultID }) else {
            throw VaultageCoreError.vaultNotFound
        }

        var vaultKey = try openVaultKey(
            collectionStorageVersion: collection.storageVersion,
            collectionKey: collectionKey,
            vaultID: vaultID,
            wrappedKey: entry.wrappedKey
        )
        defer { vaultKey.resetBytes(in: vaultKey.startIndex..<vaultKey.endIndex) }

        let state = RecordProjectionState(
            vaultKey: vaultKey,
            manifest: entry.manifest,
            loadRecordBlob: loadRecordBlob
        )
        defer { state.clearKey() }
        return CredentialListProjection(
            vaultID: entry.projection.id,
            vaultName: entry.projection.name,
            credentials: try state.projectCredentials()
        )
    }

    public static func projectCredentialDetail(
        encryptedCollection: Data,
        collectionKey: Data,
        vaultID: String,
        credentialID: String,
        loadRecordBlob: @escaping (String) throws -> Data
    ) throws -> CredentialDetailProjection {
        let collection = try VaultCollectionReader.validatedCollection(
            encryptedCollection: encryptedCollection,
            collectionKey: collectionKey
        )
        guard let entry = collection.entries.first(where: { $0.projection.id == vaultID }),
              !entry.projection.isArchived else {
            throw VaultageCoreError.vaultNotFound
        }

        var vaultKey = try openVaultKey(
            collectionStorageVersion: collection.storageVersion,
            collectionKey: collectionKey,
            vaultID: vaultID,
            wrappedKey: entry.wrappedKey
        )
        defer { vaultKey.resetBytes(in: vaultKey.startIndex..<vaultKey.endIndex) }

        let state = RecordProjectionState(
            vaultKey: vaultKey,
            manifest: entry.manifest,
            loadRecordBlob: loadRecordBlob
        )
        defer { state.clearKey() }
        return CredentialDetailProjection(
            vaultID: entry.projection.id,
            vaultName: entry.projection.name,
            credential: try state.projectCredentialDetail(credentialID: credentialID)
        )
    }

    public static func releaseCredentialField(
        encryptedCollection: Data,
        collectionKey: Data,
        vaultID: String,
        selector: CredentialFieldSelector,
        loadRecordBlob: @escaping (String) throws -> Data
    ) throws -> CredentialFieldValueLease {
        let collection = try VaultCollectionReader.validatedCollection(
            encryptedCollection: encryptedCollection,
            collectionKey: collectionKey
        )
        guard let entry = collection.entries.first(where: { $0.projection.id == vaultID }),
              !entry.projection.isArchived else {
            throw VaultageCoreError.vaultNotFound
        }

        var vaultKey = try openVaultKey(
            collectionStorageVersion: collection.storageVersion,
            collectionKey: collectionKey,
            vaultID: vaultID,
            wrappedKey: entry.wrappedKey
        )
        defer { vaultKey.resetBytes(in: vaultKey.startIndex..<vaultKey.endIndex) }

        let state = RecordProjectionState(
            vaultKey: vaultKey,
            manifest: entry.manifest,
            loadRecordBlob: loadRecordBlob
        )
        defer { state.clearKey() }
        return try state.releaseCredentialField(selector: selector)
    }

    private static func openVaultKey(
        collectionStorageVersion: Int,
        collectionKey: Data,
        vaultID: String,
        wrappedKey: Data?
    ) throws -> Data {
        if collectionStorageVersion == 1 {
            return Data(collectionKey)
        }
        guard collectionStorageVersion == 2, let wrappedKey, wrappedKey.count == 60 else {
            throw VaultageCoreError.invalidWrappedKey
        }
        let aad = Data("vaultage.vault-entry-key.aad.v1\0\(vaultID)".utf8)
        do {
            let nonce = try AES.GCM.Nonce(data: wrappedKey.prefix(12))
            let box = try AES.GCM.SealedBox(
                nonce: nonce,
                ciphertext: wrappedKey.dropFirst(28),
                tag: wrappedKey.dropFirst(12).prefix(16)
            )
            let opened = try AES.GCM.open(
                box,
                using: SymmetricKey(data: collectionKey),
                authenticating: aad
            )
            guard opened.count == 32 else { throw VaultageCoreError.invalidWrappedKey }
            return opened
        } catch let error as VaultageCoreError {
            throw error
        } catch {
            throw VaultageCoreError.invalidWrappedKey
        }
    }
}

private final class RecordProjectionState {
    private static let recordFormat = "vaultage.record.v1"
    private static let paddedMagic = Data("VLTREC02".utf8)
    private static let paddedHeaderBytes = 12
    private static let paddedBucketBytes = 256
    private static let maximumRecordBlobBytes = 10 * 1024 * 1024 + 64 * 1024
    private static let maximumAggregateEncryptedBytes = 64 * 1024 * 1024
    private static let maximumFolders = 10_000
    private static let maximumSecrets = 50_000
    private static let maximumFieldsPerSecret = 256
    private static let maximumFields = 250_000
    private static let maximumItemOrderEntries = 100_000
    private static let maximumFolderDepth = 32
    private static let maximumIDCharacters = 240
    private static let maximumNameCharacters = 512
    private static let maximumFieldKeyCharacters = 256
    private static let maximumFieldValueCharacters = 2 * 1024 * 1024
    private static let maximumImageFieldValueCharacters = (7 * 1024 * 1024 * 4 + 2) / 3 + 256
    private static let maximumEmbeddedImageBytes = 7 * 1024 * 1024
    private static let maximumReleasedFieldBytes = 1_000_000
    private static let maximumNotesCharacters = 2 * 1024 * 1024
    private static let redactedSecretValue = "__VAULTAGE_REDACTED_SECRET_FIELD__"
    private static let redactedProviderConfigValue = "__VAULTAGE_REDACTED_PROVIDER_CONFIG__"
    private static let supportedSecretTypes: Set<String> = [
        "password", "apiKey", "sshKey", "secureNote", "custom", "image", "certificate",
    ]
    private static let supportedProviderTypes: Set<String> = [
        "doppler", "vercel", "cloudflare", "gitlab", "github", "aws", "gcp", "azure",
        "openai", "supabase", "firebase", "netlify", "twilio", "resend", "custom",
    ]

    private enum RecordKind: String {
        case folder
        case secret
        case provider
        case providerGroup = "provider-group"
        case environmentProject = "env-project"
        case preferences
        case extras
    }

    private struct StoredRecord {
        let kind: RecordKind
        let value: Any
    }

    private struct FolderResult {
        let id: String
        let credentials: [CredentialListItem]
        let detail: CredentialDetail?
        let fieldValue: CredentialFieldValueLease?
    }

    private struct SecretResult {
        let item: CredentialListItem
        let detail: CredentialDetail?
        let fieldValue: CredentialFieldValueLease?
    }

    private let manifest: ValidatedRecordManifest
    private let loadRecordBlob: (String) throws -> Data
    private var vaultKey: Data
    private var aggregateEncryptedBytes = 0
    private var folderCount = 0
    private var secretCount = 0
    private var fieldCount = 0
    private var itemOrderCount = 0
    private var embeddedImageBytes = 0
    private var folderIDs = Set<String>()
    private var secretIDs = Set<String>()
    private var providerIDs = Set<String>()
    private var providerLinks: [String] = []
    private var providerGroupIDs = Set<String>()
    private var providerGroupLinks: [String] = []

    init(
        vaultKey: Data,
        manifest: ValidatedRecordManifest,
        loadRecordBlob: @escaping (String) throws -> Data
    ) {
        self.vaultKey = vaultKey
        self.manifest = manifest
        self.loadRecordBlob = loadRecordBlob
    }

    func clearKey() {
        vaultKey.resetBytes(in: vaultKey.startIndex..<vaultKey.endIndex)
    }

    func projectCredentials() throws -> [CredentialListItem] {
        try loadProviders()
        let result = try projectFolder(
            recordID: manifest.root,
            parentPath: [],
            ancestry: [],
            depth: 0,
            requestedCredentialID: nil,
            requestedField: nil
        )
        try validateProviderReferences()
        return result.credentials
    }

    func projectCredentialDetail(credentialID: String) throws -> CredentialDetail {
        let requestedID = try semanticID(credentialID)
        try loadProviders()
        let result = try projectFolder(
            recordID: manifest.root,
            parentPath: [],
            ancestry: [],
            depth: 0,
            requestedCredentialID: requestedID,
            requestedField: nil
        )
        try validateProviderReferences()
        guard let detail = result.detail else { throw VaultageCoreError.credentialNotFound }
        return detail
    }

    func releaseCredentialField(selector: CredentialFieldSelector) throws -> CredentialFieldValueLease {
        let credentialID = try semanticID(selector.credentialID)
        let fieldKey = try text(selector.key, maximum: Self.maximumFieldKeyCharacters)
        if let fieldID = selector.fieldID {
            _ = try semanticID(fieldID)
        } else {
            guard selector.position >= 0, selector.position < Self.maximumFieldsPerSecret else {
                throw VaultageCoreError.fieldNotFound
            }
        }
        let validatedSelector = CredentialFieldSelector(
            credentialID: credentialID,
            fieldID: selector.fieldID,
            position: selector.position,
            key: fieldKey
        )
        try loadProviders()
        let result = try projectFolder(
            recordID: manifest.root,
            parentPath: [],
            ancestry: [],
            depth: 0,
            requestedCredentialID: nil,
            requestedField: validatedSelector
        )
        try validateProviderReferences()
        guard let lease = result.fieldValue else { throw VaultageCoreError.fieldNotFound }
        return lease
    }

    private func loadProviders() throws {
        for recordID in manifest.providerGroups {
            let stored = try load(recordID: recordID, expectedKind: .providerGroup)
            try validateProviderGroup(stored.value)
        }
        for recordID in manifest.providers {
            let stored = try load(recordID: recordID, expectedKind: .provider)
            try validateProvider(stored.value)
        }
    }

    private func validateProviderReferences() throws {
        guard providerLinks.allSatisfy(providerIDs.contains),
              providerGroupLinks.allSatisfy(providerGroupIDs.contains) else {
            throw VaultageCoreError.invalidRecord
        }
    }

    private func projectFolder(
        recordID: String,
        parentPath: [String],
        ancestry: Set<String>,
        depth: Int,
        requestedCredentialID: String?,
        requestedField: CredentialFieldSelector?
    ) throws -> FolderResult {
        guard depth <= Self.maximumFolderDepth, !ancestry.contains(recordID) else {
            throw VaultageCoreError.invalidRecord
        }
        folderCount += 1
        guard folderCount <= Self.maximumFolders else { throw VaultageCoreError.recordLimitExceeded }

        let stored = try load(recordID: recordID, expectedKind: .folder)
        guard let value = stored.value as? [String: Any],
              let metadata = value["metadata"] as? [String: Any] else {
            throw VaultageCoreError.invalidRecord
        }
        let folderID = try semanticID(metadata["id"])
        guard folderIDs.insert(folderID).inserted else { throw VaultageCoreError.invalidRecord }
        let folderName = try text(metadata["name"], maximum: Self.maximumNameCharacters)
        let path = parentPath + [folderName]
        let nextAncestry = ancestry.union([recordID])

        let childRecordIDs = try optionalRecordIDs(
            value["children"],
            maximum: Self.maximumFolders
        )
        let secretRecordIDs = try optionalRecordIDs(
            value["secrets"],
            maximum: Self.maximumSecrets
        )
        var children: [FolderResult] = []
        children.reserveCapacity(childRecordIDs.count)
        for childRecordID in childRecordIDs {
            children.append(try projectFolder(
                recordID: childRecordID,
                parentPath: path,
                ancestry: nextAncestry,
                depth: depth + 1,
                requestedCredentialID: requestedCredentialID,
                requestedField: requestedField
            ))
        }
        var secrets: [CredentialListItem] = []
        var detail = try uniqueDetail(children.compactMap(\.detail))
        var fieldValue = try uniqueFieldValue(children.compactMap(\.fieldValue))
        secrets.reserveCapacity(secretRecordIDs.count)
        for secretRecordID in secretRecordIDs {
            let result = try projectSecret(
                recordID: secretRecordID,
                folderPath: path,
                requestedCredentialID: requestedCredentialID,
                requestedField: requestedField
            )
            secrets.append(result.item)
            if let candidate = result.detail {
                guard detail == nil else { throw VaultageCoreError.invalidRecord }
                detail = candidate
            }
            if let candidate = result.fieldValue {
                guard fieldValue == nil else { throw VaultageCoreError.invalidRecord }
                fieldValue = candidate
            }
        }

        let ordered = try orderCredentials(
            metadata: metadata,
            children: children,
            secrets: secrets
        )
        return FolderResult(id: folderID, credentials: ordered, detail: detail, fieldValue: fieldValue)
    }

    private func projectSecret(
        recordID: String,
        folderPath: [String],
        requestedCredentialID: String?,
        requestedField: CredentialFieldSelector?
    ) throws -> SecretResult {
        secretCount += 1
        guard secretCount <= Self.maximumSecrets else { throw VaultageCoreError.recordLimitExceeded }
        let stored = try load(recordID: recordID, expectedKind: .secret)
        guard let secret = stored.value as? [String: Any],
              let fields = secret["fields"] as? [Any],
              fields.count <= Self.maximumFieldsPerSecret,
              let notes = secret["notes"] as? String,
              notes.utf16.count <= Self.maximumNotesCharacters,
              notes != Self.redactedSecretValue else {
            throw VaultageCoreError.invalidRecord
        }

        let id = try semanticID(secret["id"])
        guard secretIDs.insert(id).inserted else { throw VaultageCoreError.invalidRecord }
        let name = try text(secret["name"], maximum: Self.maximumNameCharacters)
        guard let type = secret["type"] as? String, Self.supportedSecretTypes.contains(type) else {
            throw VaultageCoreError.invalidRecord
        }
        let createdAt = try isoDateTime(secret["createdAt"])
        let updatedAt = try isoDateTime(secret["updatedAt"])

        fieldCount += fields.count
        guard fieldCount <= Self.maximumFields else { throw VaultageCoreError.recordLimitExceeded }
        let wantsDetail = id == requestedCredentialID
        let wantsField = id == requestedField?.credentialID
        var fieldIDs = Set<String>()
        var imageFieldCount = 0
        var descriptors: [CredentialFieldDescriptor] = []
        var selectedFieldValue: CredentialFieldValueLease?
        if wantsDetail { descriptors.reserveCapacity(fields.count) }
        for (position, value) in fields.enumerated() {
            guard let field = value as? [String: Any],
                  let fieldValue = field["value"] as? String,
                  fieldValue != Self.redactedSecretValue,
                  let sensitive = field["sensitive"] as? Bool else {
                throw VaultageCoreError.invalidRecord
            }
            let fieldKey = try text(field["key"], maximum: Self.maximumFieldKeyCharacters)
            let maximumValue = type == "image"
                ? Self.maximumImageFieldValueCharacters
                : Self.maximumFieldValueCharacters
            guard fieldValue.utf16.count <= maximumValue else { throw VaultageCoreError.recordLimitExceeded }
            let fieldID: String?
            if let rawFieldID = field["id"] {
                let validatedFieldID = try semanticID(rawFieldID)
                guard fieldIDs.insert(validatedFieldID).inserted else {
                    throw VaultageCoreError.invalidRecord
                }
                fieldID = validatedFieldID
            } else {
                fieldID = nil
            }
            if type == "image", fieldKey == "__image__" {
                guard sensitive else { throw VaultageCoreError.invalidRecord }
                imageFieldCount += 1
                try validateEmbeddedImage(fieldValue)
            }
            if wantsDetail {
                descriptors.append(CredentialFieldDescriptor(
                    id: fieldID,
                    position: position,
                    key: fieldKey,
                    sensitive: sensitive,
                    hasValue: !fieldValue.isEmpty
                ))
            }
            if wantsField, let requestedField {
                let matches: Bool
                if let requestedID = requestedField.fieldID {
                    matches = fieldID == requestedID && fieldKey == requestedField.key
                } else {
                    matches = fieldID == nil
                        && position == requestedField.position
                        && fieldKey == requestedField.key
                }
                if matches {
                    guard selectedFieldValue == nil else { throw VaultageCoreError.invalidRecord }
                    guard fieldValue.utf8.count <= Self.maximumReleasedFieldBytes else {
                        throw VaultageCoreError.fieldValueTooLarge
                    }
                    selectedFieldValue = CredentialFieldValueLease(bytes: Data(fieldValue.utf8))
                }
            }
        }
        if type == "image", imageFieldCount != 1 { throw VaultageCoreError.invalidRecord }

        let item = CredentialListItem(
            id: id,
            name: name,
            type: type,
            createdAt: createdAt,
            updatedAt: updatedAt,
            folderPath: folderPath,
            fieldCount: fields.count
        )
        let optional = try validateOptionalMetadata(secret)
        if type == "certificate" {
            guard let certificate = secret["certificate"] else {
                throw VaultageCoreError.invalidRecord
            }
            try validateCertificateMetadata(certificate)
        } else if secret["certificate"] != nil {
            throw VaultageCoreError.invalidRecord
        }
        if wantsField {
            guard optional.accessPolicy.revealCopy else {
                selectedFieldValue?.invalidate()
                selectedFieldValue = nil
                throw VaultageCoreError.fieldReleaseDenied
            }
            guard selectedFieldValue != nil else { throw VaultageCoreError.fieldNotFound }
        }
        let detail = wantsDetail ? CredentialDetail(
            id: id,
            name: name,
            type: type,
            createdAt: createdAt,
            updatedAt: updatedAt,
            folderPath: folderPath,
            scope: optional.scope,
            tags: optional.tags,
            expiresAt: optional.expiresAt,
            accessPolicy: optional.accessPolicy,
            fields: descriptors
        ) : nil
        return SecretResult(item: item, detail: detail, fieldValue: selectedFieldValue)
    }

    private struct OptionalSecretMetadata {
        let scope: String?
        let tags: [String]
        let expiresAt: String?
        let accessPolicy: CredentialAccessPolicy
    }

    private func validateOptionalMetadata(_ secret: [String: Any]) throws -> OptionalSecretMetadata {
        _ = try optionalText(secret["description"], maximum: 64 * 1024)
        let scope = try optionalText(secret["scope"], maximum: 256)
        let tags = try optionalStringArray(secret["tags"], maximumItems: 1_000, maximumCharacters: 512)
        let expiresAt = try optionalDateOrDateTime(secret["expiresAt"])
        _ = try optionalStringArray(secret["usedIn"], maximumItems: 10_000, maximumCharacters: 4_096)
        if let lastUsedAt = secret["lastUsedAt"] { _ = try isoDateTime(lastUsedAt) }
        _ = try optionalNonnegativeSafeInteger(secret["usageCount"])

        let agent = try optionalBoolean(secret["agentAvailable"])
        let browser = try optionalBoolean(secret["browserExtensionAllowed"])
        let reveal = try optionalBoolean(secret["revealAllowed"])
        let cli = try optionalBoolean(secret["cliExportAllowed"])
        if let providerLink = secret["providerLink"] {
            providerLinks.append(try validateProviderLink(providerLink))
        }
        return OptionalSecretMetadata(
            scope: scope,
            tags: tags,
            expiresAt: expiresAt,
            accessPolicy: CredentialAccessPolicy(
                browserExtension: browser ?? (agent == true),
                agent: agent == true,
                revealCopy: reveal != false,
                cliExport: cli != false
            )
        )
    }

    private func validateProviderLink(_ value: Any) throws -> String {
        guard let link = value as? [String: Any] else { throw VaultageCoreError.invalidRecord }
        let providerID = try semanticID(link["providerId"])
        _ = try optionalTextRequired(link["remoteName"], maximum: 1_024)
        guard try optionalBoolean(link["createdInVaultage"]) != nil else {
            throw VaultageCoreError.invalidRecord
        }
        _ = try optionalStringArray(link["scopes"], maximumItems: 1_000, maximumCharacters: 1_024)
        _ = try optionalText(link["remoteId"], maximum: 1_024)
        if let lastVerifiedAt = link["lastVerifiedAt"] { _ = try isoDateTime(lastVerifiedAt) }
        if let status = link["status"] {
            guard let status = status as? String,
                  ["active", "revoked", "missing"].contains(status) else {
                throw VaultageCoreError.invalidRecord
            }
        }
        if let statusUpdatedAt = link["statusUpdatedAt"] { _ = try isoDateTime(statusUpdatedAt) }
        return providerID
    }

    private func validateProvider(_ value: Any) throws {
        guard let provider = value as? [String: Any] else { throw VaultageCoreError.invalidRecord }
        let providerID = try semanticID(provider["id"])
        guard providerIDs.insert(providerID).inserted else { throw VaultageCoreError.invalidRecord }
        _ = try text(provider["name"], maximum: Self.maximumNameCharacters)
        guard let type = provider["type"] as? String,
              Self.supportedProviderTypes.contains(type),
              let config = provider["config"] as? [String: Any],
              config.count <= 256 else {
            throw VaultageCoreError.invalidRecord
        }
        for (key, rawValue) in config {
            guard !key.isEmpty, key.utf16.count <= Self.maximumFieldKeyCharacters,
                  let value = rawValue as? String,
                  value.utf16.count <= Self.maximumFieldValueCharacters,
                  value != Self.redactedProviderConfigValue else {
                throw VaultageCoreError.invalidRecord
            }
        }
        if let lastSyncAt = provider["lastSyncAt"] { _ = try isoDateTime(lastSyncAt) }
        if let connectionStatus = provider["connectionStatus"] {
            guard let connectionStatus = connectionStatus as? String,
                  ["configured", "verified", "error"].contains(connectionStatus) else {
                throw VaultageCoreError.invalidRecord
            }
        }
        if let lastTestedAt = provider["lastTestedAt"] { _ = try isoDateTime(lastTestedAt) }
        if let connection = provider["connection"] { try validateProviderConnection(connection) }
        if let groupID = provider["groupId"], !(groupID is NSNull) {
            providerGroupLinks.append(try semanticID(groupID))
        }
    }

    private func validateProviderGroup(_ value: Any) throws {
        guard let group = value as? [String: Any] else { throw VaultageCoreError.invalidRecord }
        let groupID = try semanticID(group["id"])
        guard providerGroupIDs.insert(groupID).inserted else { throw VaultageCoreError.invalidRecord }
        _ = try text(group["name"], maximum: Self.maximumNameCharacters)
        if let category = group["categoryId"] {
            guard let category = category as? String,
                  ["build", "ai", "code", "backend", "deploy", "secure", "connect", "observe", "monetize"].contains(category) else {
                throw VaultageCoreError.invalidRecord
            }
        }
    }

    private func validateProviderConnection(_ value: Any) throws {
        guard let connection = value as? [String: Any] else { throw VaultageCoreError.invalidRecord }
        let required = Set([
            "schemaVersion", "environment", "authMethod", "custody", "state", "refreshState",
            "identity", "capabilities",
        ])
        let optional = Set(["expiresAt", "verifiedAt", "lastUsedAt", "accountBoundary"])
        guard required.isSubset(of: Set(connection.keys)),
              Set(connection.keys).isSubset(of: required.union(optional)),
              try optionalNonnegativeSafeInteger(connection["schemaVersion"]) == 1,
              let environment = connection["environment"] as? String,
              ["local", "development", "staging", "production", "other"].contains(environment),
              let authMethod = connection["authMethod"] as? String,
              ["api-token", "oauth", "cli-profile", "temporary-session", "service-account", "certificate", "unknown"].contains(authMethod),
              let custody = connection["custody"] as? String,
              ["encrypted-vault", "keychain", "provider-managed", "cli", "external"].contains(custody),
              let state = connection["state"] as? String,
              ["active", "paused", "expired", "revoked", "error", "partial"].contains(state),
              let refreshState = connection["refreshState"] as? String,
              ["idle", "refreshing", "reauth-required", "failed", "not-supported"].contains(refreshState),
              let identity = connection["identity"] as? [String: Any],
              Set(identity.keys).isSubset(of: Set(["account", "organization", "tenant", "profile", "region", "target"])),
              let capabilities = connection["capabilities"] as? [Any], capabilities.count <= 100 else {
            throw VaultageCoreError.invalidRecord
        }
        // Shipping normalization deliberately drops invalid optional identity
        // labels instead of rejecting the persisted provider record.
        _ = identity
        for value in capabilities {
            guard let value = value as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  value.utf16.count <= 256,
                  value != Self.redactedProviderConfigValue else {
                throw VaultageCoreError.invalidRecord
            }
        }
        for key in ["expiresAt", "verifiedAt", "lastUsedAt"] where connection[key] != nil {
            try canonicalProviderTimestamp(connection[key])
        }
        if let accountBoundary = connection["accountBoundary"] {
            guard let accountBoundary = accountBoundary as? String,
                  ["matched", "unverified", "mismatch"].contains(accountBoundary) else {
                throw VaultageCoreError.invalidRecord
            }
        }
    }

    private func canonicalProviderTimestamp(_ value: Any?) throws {
        guard let value = value as? String,
              value.range(
                  of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#,
                  options: .regularExpression
              ) != nil,
              let date = parsedISODateTime(value) else {
            throw VaultageCoreError.invalidRecord
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard formatter.string(from: date) == value else { throw VaultageCoreError.invalidRecord }
    }

    private func validateEmbeddedImage(_ value: String) throws {
        guard !value.isEmpty else { return }
        if value.range(
            of: #"^vaultage-attachment:v1:[0-9a-f]{64}:image/[a-z0-9][a-z0-9.+-]{0,63}$"#,
            options: .regularExpression
        ) != nil {
            return
        }
        let expression = try NSRegularExpression(
            pattern: #"^data:image/[a-z0-9.+-]+;base64,([a-z0-9+/= \t\r\n]+)$"#,
            options: [.caseInsensitive]
        )
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        guard let match = expression.firstMatch(in: value, range: range),
              match.range.location == 0,
              match.range.length == range.length,
              let payloadRange = Range(match.range(at: 1), in: value) else {
            throw VaultageCoreError.invalidRecord
        }
        let base64 = value[payloadRange].filter { character in
            character != " " && character != "\t" && character != "\r" && character != "\n"
        }
        guard isCanonicalBase64(base64) else { throw VaultageCoreError.invalidRecord }
        let padding = base64.hasSuffix("==") ? 2 : base64.hasSuffix("=") ? 1 : 0
        let decodedBytes = base64.count / 4 * 3 - padding
        guard decodedBytes <= Self.maximumEmbeddedImageBytes else {
            throw VaultageCoreError.recordLimitExceeded
        }
        embeddedImageBytes += decodedBytes
        guard embeddedImageBytes <= Self.maximumEmbeddedImageBytes else {
            throw VaultageCoreError.recordLimitExceeded
        }
    }

    private func isCanonicalBase64(_ value: String) -> Bool {
        guard !value.isEmpty, value.count.isMultiple(of: 4), value.utf8.allSatisfy({ $0 < 128 }) else {
            return false
        }
        let padding = value.hasSuffix("==") ? 2 : value.hasSuffix("=") ? 1 : 0
        let contentCount = value.count - padding
        guard (padding != 1 || contentCount % 4 == 3),
              (padding != 2 || contentCount % 4 == 2) else {
            return false
        }
        let bytes = Array(value.utf8)
        for byte in bytes[..<contentCount] {
            guard (65...90).contains(byte) || (97...122).contains(byte)
                    || (48...57).contains(byte) || byte == 43 || byte == 47 else {
                return false
            }
        }
        return bytes[contentCount...].allSatisfy { $0 == 61 }
    }

    private func validateCertificateMetadata(_ value: Any) throws {
        guard let metadata = value as? [String: Any] else { throw VaultageCoreError.invalidRecord }
        let allowed = Set([
            "format", "subject", "issuer", "serialNumber", "notBefore", "notAfter",
            "algorithm", "sha256Fingerprint",
        ])
        guard Set(metadata.keys).isSubset(of: allowed),
              let format = metadata["format"] as? String,
              ["PEM", "DER", "PKCS12"].contains(format) else {
            throw VaultageCoreError.invalidRecord
        }
        _ = try optionalNonemptyText(metadata["subject"], maximum: 4_096)
        _ = try optionalNonemptyText(metadata["issuer"], maximum: 4_096)
        if let serial = try optionalNonemptyText(metadata["serialNumber"], maximum: 128),
           serial.range(of: #"^[0-9A-Fa-f]{1,128}$"#, options: .regularExpression) == nil {
            throw VaultageCoreError.invalidRecord
        }
        guard (metadata["notBefore"] == nil) == (metadata["notAfter"] == nil) else {
            throw VaultageCoreError.invalidRecord
        }
        if let rawNotBefore = metadata["notBefore"], let rawNotAfter = metadata["notAfter"] {
            let notBefore = try isoDateTime(rawNotBefore)
            let notAfter = try isoDateTime(rawNotAfter)
            guard let beforeDate = parsedISODateTime(notBefore),
                  let afterDate = parsedISODateTime(notAfter),
                  afterDate > beforeDate else {
                throw VaultageCoreError.invalidRecord
            }
        }
        _ = try optionalNonemptyText(metadata["algorithm"], maximum: 256)
        if let fingerprint = try optionalNonemptyText(metadata["sha256Fingerprint"], maximum: 64),
           fingerprint.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) == nil {
            throw VaultageCoreError.invalidRecord
        }
    }

    private func uniqueDetail(_ values: [CredentialDetail]) throws -> CredentialDetail? {
        guard values.count <= 1 else { throw VaultageCoreError.invalidRecord }
        return values.first
    }

    private func uniqueFieldValue(
        _ values: [CredentialFieldValueLease]
    ) throws -> CredentialFieldValueLease? {
        guard values.count <= 1 else { throw VaultageCoreError.invalidRecord }
        return values.first
    }

    private func orderCredentials(
        metadata: [String: Any],
        children: [FolderResult],
        secrets: [CredentialListItem]
    ) throws -> [CredentialListItem] {
        let childByID = Dictionary(uniqueKeysWithValues: children.map { ($0.id, $0) })
        let secretByID = Dictionary(uniqueKeysWithValues: secrets.map { ($0.id, $0) })
        guard childByID.count == children.count, secretByID.count == secrets.count else {
            throw VaultageCoreError.invalidRecord
        }

        guard let rawOrder = metadata["itemOrder"] else {
            return children.flatMap(\.credentials) + secrets
        }
        guard let order = rawOrder as? [Any] else { throw VaultageCoreError.invalidRecord }
        itemOrderCount += order.count
        guard itemOrderCount <= Self.maximumItemOrderEntries else {
            throw VaultageCoreError.recordLimitExceeded
        }

        var seen = Set<String>()
        var ordered: [CredentialListItem] = []
        for rawItem in order {
            guard let item = rawItem as? [String: Any],
                  let kind = item["kind"] as? String else {
                throw VaultageCoreError.invalidRecord
            }
            let id = try semanticID(item["id"])
            let key = "\(kind):\(id)"
            guard seen.insert(key).inserted else { throw VaultageCoreError.invalidRecord }
            switch kind {
            case "folder":
                guard let child = childByID[id] else { throw VaultageCoreError.invalidRecord }
                ordered.append(contentsOf: child.credentials)
            case "secret":
                guard let secret = secretByID[id] else { throw VaultageCoreError.invalidRecord }
                ordered.append(secret)
            default:
                throw VaultageCoreError.invalidRecord
            }
        }
        for child in children where !seen.contains("folder:\(child.id)") {
            ordered.append(contentsOf: child.credentials)
        }
        for secret in secrets where !seen.contains("secret:\(secret.id)") {
            ordered.append(secret)
        }
        return ordered
    }

    private func load(recordID: String, expectedKind: RecordKind) throws -> StoredRecord {
        guard VaultCollectionReader.isRecordID(recordID) else { throw VaultageCoreError.invalidRecord }
        let blob: Data
        do {
            blob = try loadRecordBlob(recordID)
        } catch {
            throw VaultageCoreError.recordMissing
        }
        guard blob.count >= 29, blob.count <= Self.maximumRecordBlobBytes else {
            throw VaultageCoreError.invalidRecord
        }
        aggregateEncryptedBytes += blob.count
        guard aggregateEncryptedBytes <= Self.maximumAggregateEncryptedBytes else {
            throw VaultageCoreError.recordLimitExceeded
        }

        let stored = try verify(recordID: recordID, blob: blob)
        guard stored.kind == expectedKind else { throw VaultageCoreError.invalidRecord }
        return stored
    }

    private func verify(recordID: String, blob: Data) throws -> StoredRecord {
        var encryptionKey = derivePurposeKey("vaultage-record-encryption-v1\0\(recordID)")
        defer { encryptionKey.resetBytes(in: encryptionKey.startIndex..<encryptionKey.endIndex) }
        var plaintext: Data
        do {
            plaintext = try openNodeEnvelope(blob, key: encryptionKey)
        } catch {
            throw VaultageCoreError.recordAuthenticationFailed
        }
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }

        var canonical: Data
        let openedStorageVersion: Int
        if plaintext.starts(with: Self.paddedMagic) {
            guard plaintext.count >= Self.paddedHeaderBytes,
                  plaintext.count.isMultiple(of: Self.paddedBucketBytes) else {
                throw VaultageCoreError.invalidRecord
            }
            let length = plaintext[8..<12].reduce(0) { ($0 << 8) | Int($1) }
            let end = Self.paddedHeaderBytes + length
            guard length >= 1, end <= plaintext.count,
                  plaintext[end...].allSatisfy({ $0 == 0 }) else {
                throw VaultageCoreError.invalidRecord
            }
            canonical = Data(plaintext[Self.paddedHeaderBytes..<end])
            openedStorageVersion = 2
        } else {
            canonical = Data(plaintext)
            openedStorageVersion = 1
        }
        defer { canonical.resetBytes(in: canonical.startIndex..<canonical.endIndex) }
        guard openedStorageVersion == manifest.storageVersion else {
            throw VaultageCoreError.recordStorageVersionMismatch
        }

        var indexKey = derivePurposeKey("vaultage-record-index-v\(openedStorageVersion)")
        defer { indexKey.resetBytes(in: indexKey.startIndex..<indexKey.endIndex) }
        let digest = HMAC<SHA256>.authenticationCode(
            for: canonical,
            using: SymmetricKey(data: indexKey)
        )
        guard Data(digest).lowercaseHex == recordID else {
            throw VaultageCoreError.recordContentMismatch
        }

        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(with: canonical)
        } catch {
            throw VaultageCoreError.invalidRecord
        }
        guard let object = parsed as? [String: Any],
              object["format"] as? String == Self.recordFormat,
              let rawKind = object["kind"] as? String,
              let kind = RecordKind(rawValue: rawKind),
              let value = object["value"] else {
            throw VaultageCoreError.invalidRecord
        }
        return StoredRecord(kind: kind, value: value)
    }

    private func derivePurposeKey(_ purpose: String) -> Data {
        Data(HMAC<SHA256>.authenticationCode(
            for: Data(purpose.utf8),
            using: SymmetricKey(data: vaultKey)
        ))
    }

    private func openNodeEnvelope(_ blob: Data, key: Data) throws -> Data {
        let nonce = try AES.GCM.Nonce(data: blob.prefix(12))
        let box = try AES.GCM.SealedBox(
            nonce: nonce,
            ciphertext: blob.dropFirst(28),
            tag: blob.dropFirst(12).prefix(16)
        )
        return try AES.GCM.open(box, using: SymmetricKey(data: key))
    }

    private func recordIDValue(_ value: Any) throws -> String {
        guard let value = value as? String, VaultCollectionReader.isRecordID(value) else {
            throw VaultageCoreError.invalidRecord
        }
        return value
    }

    private func optionalRecordIDs(_ value: Any?, maximum: Int) throws -> [String] {
        guard let value else { return [] }
        guard let values = value as? [Any], values.count <= maximum else {
            throw VaultageCoreError.invalidRecord
        }
        return try values.map(recordIDValue)
    }

    private func semanticID(_ value: Any?) throws -> String {
        guard let value = value as? String,
              !value.isEmpty,
              value.utf16.count <= Self.maximumIDCharacters,
              !value.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) else {
            throw VaultageCoreError.invalidRecord
        }
        return value
    }

    private func text(_ value: Any?, maximum: Int) throws -> String {
        guard let value = value as? String, !value.isEmpty, value.utf16.count <= maximum else {
            throw VaultageCoreError.invalidRecord
        }
        return value
    }

    private func optionalText(_ value: Any?, maximum: Int) throws -> String? {
        guard let value else { return nil }
        guard let value = value as? String, value.utf16.count <= maximum else {
            throw VaultageCoreError.invalidRecord
        }
        return value
    }

    private func optionalTextRequired(_ value: Any?, maximum: Int) throws -> String {
        guard let value = try optionalText(value, maximum: maximum) else {
            throw VaultageCoreError.invalidRecord
        }
        return value
    }

    private func optionalNonemptyText(_ value: Any?, maximum: Int) throws -> String? {
        guard let value else { return nil }
        return try text(value, maximum: maximum)
    }

    private func optionalStringArray(
        _ value: Any?,
        maximumItems: Int,
        maximumCharacters: Int
    ) throws -> [String] {
        guard let value else { return [] }
        guard let values = value as? [Any], values.count <= maximumItems else {
            throw VaultageCoreError.invalidRecord
        }
        return try values.map { value in
            guard let text = value as? String, text.utf16.count <= maximumCharacters else {
                throw VaultageCoreError.invalidRecord
            }
            return text
        }
    }

    private func optionalBoolean(_ value: Any?) throws -> Bool? {
        guard let value else { return nil }
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw VaultageCoreError.invalidRecord
        }
        return number.boolValue
    }

    private func optionalNonnegativeSafeInteger(_ value: Any?) throws -> UInt64? {
        guard let value else { return nil }
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded(.towardZero) == number.doubleValue,
              number.doubleValue >= 0,
              number.doubleValue <= 9_007_199_254_740_991 else {
            throw VaultageCoreError.invalidRecord
        }
        return number.uint64Value
    }

    private func optionalDateOrDateTime(_ value: Any?) throws -> String? {
        guard let value else { return nil }
        if let text = value as? String,
           text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
            let components = text.split(separator: "-").compactMap { Int($0) }
            guard components.count == 3, components[0] >= 1 else {
                throw VaultageCoreError.invalidRecord
            }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            let dateComponents = DateComponents(
                calendar: calendar,
                timeZone: calendar.timeZone,
                year: components[0],
                month: components[1],
                day: components[2]
            )
            guard let date = calendar.date(from: dateComponents),
                  calendar.dateComponents([.year, .month, .day], from: date).year == components[0],
                  calendar.dateComponents([.year, .month, .day], from: date).month == components[1],
                  calendar.dateComponents([.year, .month, .day], from: date).day == components[2] else {
                throw VaultageCoreError.invalidRecord
            }
            return text
        }
        return try isoDateTime(value)
    }

    private func isoDateTime(_ value: Any?) throws -> String {
        guard let value = value as? String,
              value.range(
                  of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$"#,
                  options: .regularExpression
              ) != nil else {
            throw VaultageCoreError.invalidRecord
        }
        guard parsedISODateTime(value) != nil else {
            throw VaultageCoreError.invalidRecord
        }
        return value
    }

    private func parsedISODateTime(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let wholeSeconds = ISO8601DateFormatter()
        wholeSeconds.formatOptions = [.withInternetDateTime]
        return fractional.date(from: value) ?? wholeSeconds.date(from: value)
    }
}

private extension Data {
    var lowercaseHex: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
