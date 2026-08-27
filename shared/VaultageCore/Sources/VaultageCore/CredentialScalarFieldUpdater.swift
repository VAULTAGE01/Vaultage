import CoreFoundation
import CryptoKit
import Foundation

public enum CredentialFieldUpdateError: String, Error, Equatable, Sendable {
    case invalidKey
    case invalidEnvelope
    case authenticationFailed
    case invalidCollection
    case unsupportedCollectionVersion
    case invalidVaultID
    case vaultNotFound
    case vaultArchived
    case invalidWrappedKey
    case invalidCredentialID
    case invalidSelector
    case credentialNotFound
    case fieldNotFound
    case ambiguousLegacyField
    case editDenied
    case invalidValue
    case invalidTimestamp
    case invalidRecord
    case recordMissing
    case recordAuthenticationFailed
    case recordContentMismatch
    case recordStorageVersionMismatch
    case revisionOverflow
    case payloadTooLarge
    case encryptionFailed
    case cancelled
}

public struct CredentialScalarFieldUpdateSelector: Equatable, Sendable {
    public let credentialID: String
    public let fieldID: String?
    public let key: String

    public init(credentialID: String, fieldID: String?, key: String) {
        self.credentialID = credentialID
        self.fieldID = fieldID
        self.key = key
    }
}

public struct CredentialScalarFieldUpdateMetadata: Equatable, Sendable {
    public let vaultID: String
    public let credentialID: String
    public let fieldID: String?
    public let fieldKey: String
    public let collectionRevision: Int
    public let vaultRevision: Int
}

public struct CredentialScalarFieldUpdateResult: Equatable, Sendable {
    public let encryptedCollection: Data
    /// Newly content-addressed blobs only. The caller publishes these before
    /// atomically replacing `encryptedCollection`.
    public let recordBlobs: [String: Data]
    public let metadata: CredentialScalarFieldUpdateMetadata
}

public enum CredentialScalarFieldUpdater {
    private static let collectionFormat = "vaultage.vault-collection.v1"
    private static let recordStoreFormat = "vaultage.record-store.v1"
    fileprivate static let recordFormat = "vaultage.record.v1"
    fileprivate static let recordMagic = Data("VLTREC02".utf8)
    private static let maximumSafeInteger = 9_007_199_254_740_991
    private static let maximumCollectionBytes = 20 * 1024 * 1024
    private static let maximumPlaintextBytes = 10 * 1024 * 1024
    fileprivate static let maximumRecordBlobBytes = 10 * 1024 * 1024 + 64 * 1024
    private static let maximumIDCharacters = 240
    private static let maximumFieldKeyCharacters = 256
    private static let maximumFieldValueCharacters = 2 * 1024 * 1024
    fileprivate static let editableSecretTypes: Set<String> = [
        "password", "apiKey", "sshKey", "custom",
    ]
    fileprivate static let maximumFolderDepth = 32
    fileprivate static let maximumFolders = 10_000
    fileprivate static let maximumSecrets = 50_000
    fileprivate static let maximumAggregateEncryptedBytes = 64 * 1024 * 1024

    public static func updateCurrentV2CredentialScalarField(
        encryptedCollection: Data,
        consumingCollectionKey collectionKey: inout Data,
        vaultID: String,
        selector: CredentialScalarFieldUpdateSelector,
        consumingUTF8Value valueBytes: inout Data,
        updatedAt: String,
        loadRecordBlob: @escaping (String) throws -> Data
    ) throws -> CredentialScalarFieldUpdateResult {
        let validatedVaultID = try semanticID(vaultID, error: .invalidVaultID)
        let credentialID = try semanticID(selector.credentialID, error: .invalidCredentialID)
        let fieldKey = try boundedText(
            selector.key,
            maximumUTF16Count: maximumFieldKeyCharacters,
            error: .invalidSelector
        )
        let fieldID = try selector.fieldID.map { try semanticID($0, error: .invalidSelector) }
        let timestamp = try canonicalTimestamp(updatedAt)
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }

        var key = Data(collectionKey)
        collectionKey.resetBytes(in: collectionKey.startIndex..<collectionKey.endIndex)
        defer { key.resetBytes(in: key.startIndex..<key.endIndex) }
        var newValueBytes = Data(valueBytes)
        valueBytes.resetBytes(in: valueBytes.startIndex..<valueBytes.endIndex)
        defer { newValueBytes.resetBytes(in: newValueBytes.startIndex..<newValueBytes.endIndex) }

        guard key.count == 32 else { throw CredentialFieldUpdateError.invalidKey }
        guard newValueBytes.count <= maximumPlaintextBytes,
              let newValue = String(data: newValueBytes, encoding: .utf8),
              newValue.utf16.count <= maximumFieldValueCharacters,
              newValue != "__VAULTAGE_REDACTED_SECRET_FIELD__" else {
            throw CredentialFieldUpdateError.invalidValue
        }
        guard encryptedCollection.count >= 29,
              encryptedCollection.count <= maximumCollectionBytes else {
            throw CredentialFieldUpdateError.invalidEnvelope
        }

        // Reuse the strict shipping-format reader before retaining a mutable
        // parsed document. This authenticates the collection and rejects
        // unknown current-format schema at the trust boundary.
        let validated: ValidatedCollection
        do {
            validated = try VaultCollectionReader.validatedCollection(
                encryptedCollection: encryptedCollection,
                collectionKey: key
            )
        } catch {
            throw mapCoreError(error)
        }
        guard validated.storageVersion == 2 else {
            throw CredentialFieldUpdateError.unsupportedCollectionVersion
        }
        guard validated.revision < maximumSafeInteger else {
            throw CredentialFieldUpdateError.revisionOverflow
        }
        guard let validatedEntry = validated.entries.first(where: { $0.projection.id == validatedVaultID }) else {
            throw CredentialFieldUpdateError.vaultNotFound
        }
        guard !validatedEntry.projection.isArchived else {
            throw CredentialFieldUpdateError.vaultArchived
        }
        guard let entryCreatedAt = try? canonicalTimestamp(validatedEntry.projection.createdAt),
              timestamp.date >= entryCreatedAt.date else {
            throw CredentialFieldUpdateError.invalidTimestamp
        }
        guard validatedEntry.manifest.storageVersion == 2,
              validatedEntry.manifest.vaultVersion == 2 else {
            throw CredentialFieldUpdateError.unsupportedCollectionVersion
        }
        let vaultRevision = validatedEntry.manifest.revision ?? 1
        guard vaultRevision < maximumSafeInteger else {
            throw CredentialFieldUpdateError.revisionOverflow
        }

        var collectionPlaintext: Data
        do {
            collectionPlaintext = try openEnvelope(encryptedCollection, key: key)
        } catch {
            throw CredentialFieldUpdateError.authenticationFailed
        }
        defer {
            collectionPlaintext.resetBytes(
                in: collectionPlaintext.startIndex..<collectionPlaintext.endIndex
            )
        }
        guard collectionPlaintext.count <= maximumPlaintextBytes else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }
        let parsedCollection: Any
        do {
            parsedCollection = try JSONSerialization.jsonObject(with: collectionPlaintext)
        } catch {
            throw CredentialFieldUpdateError.invalidCollection
        }
        guard var collection = parsedCollection as? [String: Any],
              collection["format"] as? String == collectionFormat,
              var entries = collection["vaults"] as? [[String: Any]],
              let entryIndex = entries.firstIndex(where: { $0["id"] as? String == validatedVaultID }),
              var entryManifest = entries[entryIndex]["manifest"] as? [String: Any],
              let wrappedKey = validatedEntry.wrappedKey else {
            throw CredentialFieldUpdateError.invalidCollection
        }

        var vaultKey: Data
        do {
            let aad = Data("vaultage.vault-entry-key.aad.v1\0\(validatedVaultID)".utf8)
            vaultKey = try openEnvelope(wrappedKey, key: key, authenticating: aad)
        } catch {
            throw CredentialFieldUpdateError.invalidWrappedKey
        }
        defer { vaultKey.resetBytes(in: vaultKey.startIndex..<vaultKey.endIndex) }
        guard vaultKey.count == 32 else { throw CredentialFieldUpdateError.invalidWrappedKey }
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }

        // The existing projection validator authenticates and semantically
        // validates the entire folder/credential/provider graph, not only the
        // selected record.
        do {
            _ = try VaultRecordProjectionReader.projectCredentialDetail(
                encryptedCollection: encryptedCollection,
                collectionKey: key,
                vaultID: validatedVaultID,
                credentialID: credentialID,
                loadRecordBlob: loadRecordBlob
            )
        } catch {
            throw mapCoreError(error)
        }

        let graph = RecordUpdateGraph(
            vaultKey: vaultKey,
            manifest: validatedEntry.manifest,
            loadRecordBlob: loadRecordBlob
        )
        defer { graph.clear() }
        let changed = try graph.update(
            vaultID: validatedVaultID,
            credentialID: credentialID,
            fieldID: fieldID,
            fieldKey: fieldKey,
            newValue: newValue,
            updatedAt: timestamp.text
        )
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }

        entryManifest["revision"] = vaultRevision + 1
        entryManifest["root"] = changed.rootRecordID
        entries[entryIndex]["manifest"] = entryManifest
        entries[entryIndex]["updatedAt"] = timestamp.text
        collection["revision"] = validated.revision + 1
        collection["vaults"] = entries

        var canonicalCollection: Data
        do {
            canonicalCollection = try JSONSerialization.data(
                withJSONObject: collection,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        } catch {
            throw CredentialFieldUpdateError.invalidCollection
        }
        defer {
            canonicalCollection.resetBytes(
                in: canonicalCollection.startIndex..<canonicalCollection.endIndex
            )
        }
        guard canonicalCollection.count <= maximumPlaintextBytes else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }

        let encryptedUpdatedCollection: Data
        do {
            encryptedUpdatedCollection = try sealEnvelope(canonicalCollection, key: key)
        } catch {
            throw CredentialFieldUpdateError.encryptionFailed
        }
        guard encryptedUpdatedCollection.count <= maximumCollectionBytes else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }
        return CredentialScalarFieldUpdateResult(
            encryptedCollection: encryptedUpdatedCollection,
            recordBlobs: changed.recordBlobs,
            metadata: CredentialScalarFieldUpdateMetadata(
                vaultID: validatedVaultID,
                credentialID: credentialID,
                fieldID: changed.fieldID,
                fieldKey: fieldKey,
                collectionRevision: validated.revision + 1,
                vaultRevision: vaultRevision + 1
            )
        )
    }

    fileprivate static func semanticID(
        _ value: String,
        error: CredentialFieldUpdateError
    ) throws -> String {
        guard !value.isEmpty,
              value.utf16.count <= maximumIDCharacters,
              value.trimmingCharacters(in: .whitespacesAndNewlines) == value,
              !value.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) else {
            throw error
        }
        return value
    }

    fileprivate static func boundedText(
        _ value: String,
        maximumUTF16Count: Int,
        error: CredentialFieldUpdateError
    ) throws -> String {
        guard !value.isEmpty,
              value.utf16.count <= maximumUTF16Count,
              !value.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) else {
            throw error
        }
        return value
    }

    fileprivate static func canonicalTimestamp(_ value: String) throws -> (text: String, date: Date) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else {
            throw CredentialFieldUpdateError.invalidTimestamp
        }
        return (value, date)
    }

    fileprivate static func openEnvelope(
        _ envelope: Data,
        key: Data,
        authenticating aad: Data = Data()
    ) throws -> Data {
        guard envelope.count >= 29 else { throw CredentialFieldUpdateError.invalidEnvelope }
        let nonce = try AES.GCM.Nonce(data: envelope.prefix(12))
        let box = try AES.GCM.SealedBox(
            nonce: nonce,
            ciphertext: envelope.dropFirst(28),
            tag: envelope.dropFirst(12).prefix(16)
        )
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
    }

    fileprivate static func sealEnvelope(_ plaintext: Data, key: Data) throws -> Data {
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key))
        var result = Data(box.nonce)
        result.append(box.tag)
        result.append(box.ciphertext)
        return result
    }

    private static func mapCoreError(_ error: Error) -> CredentialFieldUpdateError {
        guard let error = error as? VaultageCoreError else { return .invalidRecord }
        switch error {
        case .invalidKey: return .invalidKey
        case .invalidEnvelope: return .invalidEnvelope
        case .authenticationFailed: return .authenticationFailed
        case .payloadTooLarge, .recordLimitExceeded: return .payloadTooLarge
        case .invalidJSON, .invalidCollection: return .invalidCollection
        case .unsupportedCollectionVersion: return .unsupportedCollectionVersion
        case .vaultNotFound: return .vaultNotFound
        case .invalidWrappedKey: return .invalidWrappedKey
        case .recordMissing: return .recordMissing
        case .recordAuthenticationFailed: return .recordAuthenticationFailed
        case .recordContentMismatch: return .recordContentMismatch
        case .recordStorageVersionMismatch: return .recordStorageVersionMismatch
        case .credentialNotFound: return .credentialNotFound
        default: return .invalidRecord
        }
    }
}

private final class RecordUpdateGraph {
    private enum Kind: String {
        case folder, secret, provider, preferences, extras
        case providerGroup = "provider-group"
        case environmentProject = "env-project"
    }

    private struct Stored {
        let kind: Kind
        let value: Any
    }

    struct Change {
        let rootRecordID: String
        let fieldID: String?
        let recordBlobs: [String: Data]
    }

    private struct FolderMutation {
        let recordID: String
        let fieldID: String?
    }

    private var vaultKey: Data
    private let manifest: ValidatedRecordManifest
    private let loader: (String) throws -> Data
    private var aggregateBytes = 0
    private var folderCount = 0
    private var secretCount = 0
    private var seenFolderRecords = Set<String>()
    private var seenCredentialIDs = Set<String>()
    private var pendingBlobs: [String: Data] = [:]

    init(
        vaultKey: Data,
        manifest: ValidatedRecordManifest,
        loadRecordBlob: @escaping (String) throws -> Data
    ) {
        self.vaultKey = vaultKey
        self.manifest = manifest
        self.loader = loadRecordBlob
    }

    func clear() {
        vaultKey.resetBytes(in: vaultKey.startIndex..<vaultKey.endIndex)
    }

    func update(
        vaultID: String,
        credentialID: String,
        fieldID: String?,
        fieldKey: String,
        newValue: String,
        updatedAt: String
    ) throws -> Change {
        guard manifest.storageVersion == 2, manifest.vaultVersion == 2 else {
            throw CredentialFieldUpdateError.unsupportedCollectionVersion
        }
        // Authenticate every directly referenced non-tree record too. The
        // projection validator already validates provider semantics.
        for id in manifest.providers { _ = try load(id, expected: .provider) }
        for id in manifest.providerGroups { _ = try load(id, expected: .providerGroup) }
        for id in manifest.envProjects { _ = try load(id, expected: .environmentProject) }
        if let id = manifest.preferences { _ = try load(id, expected: .preferences) }
        if let id = manifest.extras { _ = try load(id, expected: .extras) }

        let mutation = try mutateFolder(
            recordID: manifest.root,
            ancestry: [],
            depth: 0,
            vaultID: vaultID,
            credentialID: credentialID,
            requestedFieldID: fieldID,
            fieldKey: fieldKey,
            newValue: newValue,
            updatedAt: updatedAt
        )
        guard let mutation else { throw CredentialFieldUpdateError.credentialNotFound }
        return Change(
            rootRecordID: mutation.recordID,
            fieldID: mutation.fieldID,
            recordBlobs: pendingBlobs
        )
    }

    private func mutateFolder(
        recordID: String,
        ancestry: Set<String>,
        depth: Int,
        vaultID: String,
        credentialID: String,
        requestedFieldID: String?,
        fieldKey: String,
        newValue: String,
        updatedAt: String
    ) throws -> FolderMutation? {
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }
        guard depth <= CredentialScalarFieldUpdater.maximumFolderDepth,
              !ancestry.contains(recordID),
              seenFolderRecords.insert(recordID).inserted else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        folderCount += 1
        guard folderCount <= CredentialScalarFieldUpdater.maximumFolders else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }
        let stored = try load(recordID, expected: .folder)
        guard var folder = stored.value as? [String: Any],
              let metadata = folder["metadata"] as? [String: Any],
              let folderID = metadata["id"] as? String,
              let childIDs = folder["children"] as? [String],
              let secretIDs = folder["secrets"] as? [String] else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        _ = try CredentialScalarFieldUpdater.semanticID(folderID, error: .invalidRecord)
        if depth == 0, folderID != vaultID { throw CredentialFieldUpdateError.invalidRecord }
        let nextAncestry = ancestry.union([recordID])
        var selected: FolderMutation?
        var changedChildIDs = childIDs

        for (index, childID) in childIDs.enumerated() {
            guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }
            let child = try mutateFolder(
                recordID: childID,
                ancestry: nextAncestry,
                depth: depth + 1,
                vaultID: vaultID,
                credentialID: credentialID,
                requestedFieldID: requestedFieldID,
                fieldKey: fieldKey,
                newValue: newValue,
                updatedAt: updatedAt
            )
            if let child {
                guard selected == nil else { throw CredentialFieldUpdateError.invalidRecord }
                selected = child
                changedChildIDs[index] = child.recordID
            }
        }

        var changedSecretIDs = secretIDs
        for (index, secretID) in secretIDs.enumerated() {
            guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }
            let secret = try load(secretID, expected: .secret)
            guard let object = secret.value as? [String: Any],
                  let semanticID = object["id"] as? String else {
                throw CredentialFieldUpdateError.invalidRecord
            }
            _ = try CredentialScalarFieldUpdater.semanticID(semanticID, error: .invalidRecord)
            guard seenCredentialIDs.insert(semanticID).inserted else {
                throw CredentialFieldUpdateError.invalidRecord
            }
            secretCount += 1
            guard secretCount <= CredentialScalarFieldUpdater.maximumSecrets else {
                throw CredentialFieldUpdateError.payloadTooLarge
            }
            guard semanticID == credentialID else { continue }
            guard selected == nil else { throw CredentialFieldUpdateError.invalidRecord }
            let changed = try mutateSecret(
                object,
                requestedFieldID: requestedFieldID,
                fieldKey: fieldKey,
                newValue: newValue,
                updatedAt: updatedAt
            )
            let newSecretID = try encode(kind: .secret, value: changed.value)
            changedSecretIDs[index] = newSecretID
            selected = FolderMutation(recordID: newSecretID, fieldID: changed.fieldID)
        }

        guard let selected else { return nil }
        folder["children"] = changedChildIDs
        folder["secrets"] = changedSecretIDs
        let newFolderID = try encode(kind: .folder, value: folder)
        return FolderMutation(recordID: newFolderID, fieldID: selected.fieldID)
    }

    private func mutateSecret(
        _ original: [String: Any],
        requestedFieldID: String?,
        fieldKey: String,
        newValue: String,
        updatedAt: String
    ) throws -> (value: [String: Any], fieldID: String?) {
        guard let secretType = original["type"] as? String,
              CredentialScalarFieldUpdater.editableSecretTypes.contains(secretType),
              original["revealAllowed"] as? Bool != false,
              var fields = original["fields"] as? [[String: Any]] else {
            throw CredentialFieldUpdateError.editDenied
        }
        let index: Int
        let resolvedFieldID: String?
        if let requestedFieldID {
            let matches = fields.indices.filter { fields[$0]["id"] as? String == requestedFieldID }
            guard matches.count == 1 else { throw CredentialFieldUpdateError.fieldNotFound }
            index = matches[0]
            guard fields[index]["key"] as? String == fieldKey else {
                throw CredentialFieldUpdateError.invalidSelector
            }
            resolvedFieldID = requestedFieldID
        } else {
            let matches = fields.indices.filter {
                fields[$0]["id"] == nil && fields[$0]["key"] as? String == fieldKey
            }
            guard !matches.isEmpty else { throw CredentialFieldUpdateError.fieldNotFound }
            guard matches.count == 1 else { throw CredentialFieldUpdateError.ambiguousLegacyField }
            index = matches[0]
            resolvedFieldID = nil
        }
        guard fields[index]["value"] is String,
              fields[index]["sensitive"] is Bool,
              fieldKey != "__image__" else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        fields[index]["value"] = newValue
        var changed = original
        changed["fields"] = fields
        changed["updatedAt"] = updatedAt
        return (changed, resolvedFieldID)
    }

    private func load(_ recordID: String, expected: Kind) throws -> Stored {
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }
        guard VaultCollectionReader.isRecordID(recordID) else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        let blob: Data
        do { blob = try loader(recordID) } catch { throw CredentialFieldUpdateError.recordMissing }
        guard blob.count >= 29,
              blob.count <= CredentialScalarFieldUpdater.maximumRecordBlobBytes else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        aggregateBytes += blob.count
        guard aggregateBytes <= CredentialScalarFieldUpdater.maximumAggregateEncryptedBytes else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }
        var encryptionKey = purposeKey("vaultage-record-encryption-v1\0\(recordID)")
        defer { encryptionKey.resetBytes(in: encryptionKey.startIndex..<encryptionKey.endIndex) }
        var plaintext: Data
        do { plaintext = try CredentialScalarFieldUpdater.openEnvelope(blob, key: encryptionKey) }
        catch { throw CredentialFieldUpdateError.recordAuthenticationFailed }
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        guard plaintext.starts(with: CredentialScalarFieldUpdater.recordMagic),
              plaintext.count >= 12,
              plaintext.count.isMultiple(of: 256) else {
            throw CredentialFieldUpdateError.recordStorageVersionMismatch
        }
        let length = plaintext[8..<12].reduce(0) { ($0 << 8) | Int($1) }
        let end = 12 + length
        guard length >= 1, end <= plaintext.count,
              plaintext[end...].allSatisfy({ $0 == 0 }) else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        var canonical = Data(plaintext[12..<end])
        defer { canonical.resetBytes(in: canonical.startIndex..<canonical.endIndex) }
        var indexKey = purposeKey("vaultage-record-index-v2")
        defer { indexKey.resetBytes(in: indexKey.startIndex..<indexKey.endIndex) }
        let digest = Data(HMAC<SHA256>.authenticationCode(
            for: canonical,
            using: SymmetricKey(data: indexKey)
        )).map { String(format: "%02x", $0) }.joined()
        guard digest == recordID else { throw CredentialFieldUpdateError.recordContentMismatch }
        let parsed: Any
        do { parsed = try JSONSerialization.jsonObject(with: canonical) }
        catch { throw CredentialFieldUpdateError.invalidRecord }
        guard let object = parsed as? [String: Any],
              object["format"] as? String == CredentialScalarFieldUpdater.recordFormat,
              object["kind"] as? String == expected.rawValue,
              let value = object["value"] else {
            throw CredentialFieldUpdateError.invalidRecord
        }
        return Stored(kind: expected, value: value)
    }

    private func encode(kind: Kind, value: Any) throws -> String {
        guard !Task.isCancelled else { throw CredentialFieldUpdateError.cancelled }
        var canonical: Data
        do {
            canonical = try JSONSerialization.data(
                withJSONObject: [
                    "format": CredentialScalarFieldUpdater.recordFormat,
                    "kind": kind.rawValue,
                    "value": value,
                ],
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        } catch { throw CredentialFieldUpdateError.invalidRecord }
        defer { canonical.resetBytes(in: canonical.startIndex..<canonical.endIndex) }
        guard canonical.count <= CredentialScalarFieldUpdater.maximumRecordBlobBytes else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }
        var indexKey = purposeKey("vaultage-record-index-v2")
        defer { indexKey.resetBytes(in: indexKey.startIndex..<indexKey.endIndex) }
        let recordID = Data(HMAC<SHA256>.authenticationCode(
            for: canonical,
            using: SymmetricKey(data: indexKey)
        )).map { String(format: "%02x", $0) }.joined()
        let required = 12 + canonical.count
        let paddedCount = ((required + 255) / 256) * 256
        guard paddedCount <= CredentialScalarFieldUpdater.maximumRecordBlobBytes - 28 else {
            throw CredentialFieldUpdateError.payloadTooLarge
        }
        var padded = Data(repeating: 0, count: paddedCount)
        padded.replaceSubrange(0..<8, with: CredentialScalarFieldUpdater.recordMagic)
        let length = UInt32(canonical.count)
        padded[8] = UInt8(truncatingIfNeeded: length >> 24)
        padded[9] = UInt8(truncatingIfNeeded: length >> 16)
        padded[10] = UInt8(truncatingIfNeeded: length >> 8)
        padded[11] = UInt8(truncatingIfNeeded: length)
        padded.replaceSubrange(12..<(12 + canonical.count), with: canonical)
        defer { padded.resetBytes(in: padded.startIndex..<padded.endIndex) }
        var encryptionKey = purposeKey("vaultage-record-encryption-v1\0\(recordID)")
        defer { encryptionKey.resetBytes(in: encryptionKey.startIndex..<encryptionKey.endIndex) }
        let blob: Data
        do { blob = try CredentialScalarFieldUpdater.sealEnvelope(padded, key: encryptionKey) }
        catch { throw CredentialFieldUpdateError.encryptionFailed }
        pendingBlobs[recordID] = blob
        return recordID
    }

    private func purposeKey(_ purpose: String) -> Data {
        Data(HMAC<SHA256>.authenticationCode(
            for: Data(purpose.utf8),
            using: SymmetricKey(data: vaultKey)
        ))
    }
}
