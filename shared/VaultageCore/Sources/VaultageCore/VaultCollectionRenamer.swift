import CoreFoundation
import CryptoKit
import Foundation

public enum VaultRenameError: String, Error, Equatable, Sendable {
    case invalidKey
    case invalidEnvelope
    case authenticationFailed
    case payloadTooLarge
    case invalidJSON
    case invalidCollection
    case unsupportedCollectionVersion
    case invalidVaultID
    case invalidName
    case invalidTimestamp
    case vaultMissing
    case duplicateVaultID
    case vaultArchived
    case revisionOverflow
    case encryptionFailed
    case cancelled
}

public struct VaultRenameMetadata: Equatable, Sendable {
    public let vaultID: String
    public let name: String
    public let revision: Int
}

public struct VaultRenameResult: Equatable, Sendable {
    public let encryptedCollection: Data
    public let metadata: VaultRenameMetadata
}

public enum VaultCollectionRenamer {
    private static let collectionFormat = "vaultage.vault-collection.v1"
    private static let maximumEncryptedBytes = 20 * 1024 * 1024
    private static let maximumDecryptedBytes = 10 * 1024 * 1024
    private static let maximumVaults = 10_000
    private static let maximumIDCharacters = 240
    private static let maximumNameCharacters = 512
    private static let maximumSafeInteger = 9_007_199_254_740_991

    public static func renameCurrentV2Vault(
        encryptedCollection: Data,
        consumingCollectionKey collectionKey: inout Data,
        targetVaultID: String,
        newName: String,
        updatedAt: String
    ) throws -> VaultRenameResult {
        _ = try boundedText(
            targetVaultID,
            maximumUTF16Count: maximumIDCharacters,
            error: .invalidVaultID
        )
        _ = try boundedText(
            newName,
            maximumUTF16Count: maximumNameCharacters,
            error: .invalidName
        )
        let injectedTimestamp = try canonicalTimestamp(updatedAt)
        guard !Task.isCancelled else { throw VaultRenameError.cancelled }

        var key = Data(collectionKey)
        collectionKey.resetBytes(in: collectionKey.startIndex..<collectionKey.endIndex)
        defer { key.resetBytes(in: key.startIndex..<key.endIndex) }
        guard key.count == 32 else { throw VaultRenameError.invalidKey }
        guard encryptedCollection.count >= 29,
              encryptedCollection.count <= maximumEncryptedBytes else {
            throw VaultRenameError.invalidEnvelope
        }

        var plaintext: Data
        do {
            let nonce = try AES.GCM.Nonce(data: encryptedCollection.prefix(12))
            let sealedBox = try AES.GCM.SealedBox(
                nonce: nonce,
                ciphertext: encryptedCollection.dropFirst(28),
                tag: encryptedCollection.dropFirst(12).prefix(16)
            )
            plaintext = try AES.GCM.open(sealedBox, using: SymmetricKey(data: key))
        } catch {
            throw VaultRenameError.authenticationFailed
        }
        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        guard plaintext.count <= maximumDecryptedBytes else {
            throw VaultRenameError.payloadTooLarge
        }
        guard !Task.isCancelled else { throw VaultRenameError.cancelled }

        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(with: plaintext)
        } catch {
            throw VaultRenameError.invalidJSON
        }
        guard var collection = parsed as? [String: Any],
              collection["format"] as? String == collectionFormat else {
            throw VaultRenameError.invalidCollection
        }
        let storageVersion = try exactPositiveInteger(collection["storageVersion"])
        guard storageVersion == 2 else { throw VaultRenameError.unsupportedCollectionVersion }
        let revision = try exactPositiveInteger(collection["revision"])
        guard revision < maximumSafeInteger else { throw VaultRenameError.revisionOverflow }
        let activeVaultID = try boundedText(
            collection["activeVaultId"],
            maximumUTF16Count: maximumIDCharacters,
            error: .invalidCollection
        )
        guard var vaults = collection["vaults"] as? [Any],
              !vaults.isEmpty,
              vaults.count <= maximumVaults else {
            throw VaultRenameError.invalidCollection
        }

        var seenVaultIDs = Set<String>()
        var targetIndex: Int?
        var activeVaultIsAvailable = false
        for index in vaults.indices {
            guard let entry = vaults[index] as? [String: Any] else {
                throw VaultRenameError.invalidCollection
            }
            let vaultID = try boundedText(
                entry["id"],
                maximumUTF16Count: maximumIDCharacters,
                error: .invalidCollection
            )
            guard seenVaultIDs.insert(vaultID).inserted else {
                throw VaultRenameError.duplicateVaultID
            }
            _ = try boundedText(
                entry["name"],
                maximumUTF16Count: maximumNameCharacters,
                error: .invalidCollection
            )
            let createdAt = try canonicalTimestampValue(entry["createdAt"], error: .invalidCollection)
            let currentUpdatedAt = try canonicalTimestampValue(entry["updatedAt"], error: .invalidCollection)
            guard currentUpdatedAt.date >= createdAt.date,
                  let archived = entry["archived"] as? Bool else {
                throw VaultRenameError.invalidCollection
            }
            if vaultID == activeVaultID { activeVaultIsAvailable = !archived }
            if vaultID == targetVaultID {
                targetIndex = index
                guard !archived else { throw VaultRenameError.vaultArchived }
                guard injectedTimestamp.date >= createdAt.date else {
                    throw VaultRenameError.invalidTimestamp
                }
            }
        }
        guard activeVaultIsAvailable else { throw VaultRenameError.invalidCollection }
        guard let targetIndex else { throw VaultRenameError.vaultMissing }

        // Match the persisted shipping boundary before emitting a new blob.
        // The reader rejects unknown collection/entry/envelope fields; the
        // shipping validator normalizes record manifests to their known keys.
        do {
            _ = try VaultCollectionReader.validatedCollection(
                encryptedCollection: encryptedCollection,
                collectionKey: key
            )
        } catch {
            throw VaultRenameError.invalidCollection
        }
        let manifestKeys: Set<String> = [
            "format", "storageVersion", "vaultVersion", "revision", "root",
            "providers", "providerGroups", "providerGroupsPresent", "envProjects",
            "preferences", "extras",
        ]
        for index in vaults.indices {
            var entry = vaults[index] as! [String: Any]
            guard let manifest = entry["manifest"] as? [String: Any] else {
                throw VaultRenameError.invalidCollection
            }
            entry["manifest"] = manifest.filter { manifestKeys.contains($0.key) }
            vaults[index] = entry
        }

        var target = vaults[targetIndex] as! [String: Any]
        target["name"] = newName
        target["updatedAt"] = injectedTimestamp.text
        vaults[targetIndex] = target
        let newRevision = revision + 1
        collection["revision"] = newRevision
        collection["vaults"] = vaults

        var canonicalPlaintext: Data
        do {
            canonicalPlaintext = try JSONSerialization.data(
                withJSONObject: collection,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        } catch {
            throw VaultRenameError.invalidCollection
        }
        defer {
            canonicalPlaintext.resetBytes(
                in: canonicalPlaintext.startIndex..<canonicalPlaintext.endIndex
            )
        }
        guard canonicalPlaintext.count <= maximumDecryptedBytes else {
            throw VaultRenameError.payloadTooLarge
        }
        guard !Task.isCancelled else { throw VaultRenameError.cancelled }

        do {
            let sealedBox = try AES.GCM.seal(
                canonicalPlaintext,
                using: SymmetricKey(data: key)
            )
            var encrypted = Data(sealedBox.nonce)
            encrypted.append(sealedBox.tag)
            encrypted.append(sealedBox.ciphertext)
            guard encrypted.count <= maximumEncryptedBytes else {
                throw VaultRenameError.payloadTooLarge
            }
            guard !Task.isCancelled else { throw VaultRenameError.cancelled }
            return VaultRenameResult(
                encryptedCollection: encrypted,
                metadata: VaultRenameMetadata(
                    vaultID: targetVaultID,
                    name: newName,
                    revision: newRevision
                )
            )
        } catch let error as VaultRenameError {
            throw error
        } catch {
            throw VaultRenameError.encryptionFailed
        }
    }

    private static func exactPositiveInteger(_ value: Any?) throws -> Int {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue >= 1,
              number.doubleValue <= Double(maximumSafeInteger),
              number.doubleValue.rounded(.towardZero) == number.doubleValue else {
            throw VaultRenameError.invalidCollection
        }
        return number.intValue
    }

    private static func boundedText(
        _ value: Any?,
        maximumUTF16Count: Int,
        error: VaultRenameError
    ) throws -> String {
        guard let text = value as? String,
              !text.isEmpty,
              text.utf16.count <= maximumUTF16Count,
              text.trimmingCharacters(in: .whitespacesAndNewlines) == text,
              !text.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) else {
            throw error
        }
        return text
    }

    private static func canonicalTimestamp(_ text: String) throws -> (text: String, date: Date) {
        try canonicalTimestampValue(text, error: .invalidTimestamp)
    }

    private static func canonicalTimestampValue(
        _ value: Any?,
        error: VaultRenameError
    ) throws -> (text: String, date: Date) {
        guard let text = value as? String else { throw error }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: text), formatter.string(from: date) == text else {
            throw error
        }
        return (text, date)
    }
}
