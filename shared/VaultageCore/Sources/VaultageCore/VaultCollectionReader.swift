import CoreFoundation
import CryptoKit
import Foundation

struct ValidatedCollection {
    let storageVersion: Int
    let revision: Int
    let activeVaultID: String
    let entries: [ValidatedVaultEntry]

    var projection: VaultCollectionProjection {
        VaultCollectionProjection(
            storageVersion: storageVersion,
            revision: revision,
            activeVaultID: activeVaultID,
            vaults: entries.map(\.projection)
        )
    }
}

struct ValidatedVaultEntry {
    let projection: VaultListItem
    let wrappedKey: Data?
    let manifest: ValidatedRecordManifest
}

struct ValidatedRecordManifest {
    let storageVersion: Int
    let vaultVersion: Int
    let revision: Int?
    let root: String
    let providers: [String]
    let providerGroups: [String]
    let providerGroupsPresent: Bool
    let envProjects: [String]
    let preferences: String?
    let extras: String?
}

public enum VaultCollectionReader {
    private static let collectionFormat = "vaultage.vault-collection.v1"
    private static let recordStoreFormat = "vaultage.record-store.v1"
    private static let keyEnvelopeFormat = "vaultage.vault-key-envelope.v1"
    private static let maximumDecryptedBytes = 10 * 1024 * 1024
    private static let maximumEncryptedBytes = 20 * 1024 * 1024
    private static let maximumVaults = 10_000
    private static let maximumProviders = 1_000
    private static let maximumProviderGroups = 1_000
    private static let maximumProjects = 10_000
    private static let maximumReceipts = 16
    private static let maximumIDCharacters = 240
    private static let maximumNameCharacters = 512
    private static let maximumSafeInteger = 9_007_199_254_740_991

    public static func projectList(
        encryptedCollection: Data,
        collectionKey: Data
    ) throws -> VaultCollectionProjection {
        try validatedCollection(
            encryptedCollection: encryptedCollection,
            collectionKey: collectionKey
        ).projection
    }

    static func validatedCollection(
        encryptedCollection: Data,
        collectionKey: Data
    ) throws -> ValidatedCollection {
        guard collectionKey.count == 32 else { throw VaultageCoreError.invalidKey }
        guard encryptedCollection.count >= 29, encryptedCollection.count <= maximumEncryptedBytes else {
            throw VaultageCoreError.invalidEnvelope
        }

        let nonceData = encryptedCollection.prefix(12)
        let tag = encryptedCollection.dropFirst(12).prefix(16)
        let ciphertext = encryptedCollection.dropFirst(28)
        var plaintext: Data
        do {
            let nonce = try AES.GCM.Nonce(data: nonceData)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            plaintext = try AES.GCM.open(box, using: SymmetricKey(data: collectionKey))
        } catch {
            throw VaultageCoreError.authenticationFailed
        }
        guard plaintext.count <= maximumDecryptedBytes else { throw VaultageCoreError.payloadTooLarge }

        defer { plaintext.resetBytes(in: plaintext.startIndex..<plaintext.endIndex) }
        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: plaintext)
        } catch {
            throw VaultageCoreError.invalidJSON
        }
        return try validateCollection(value)
    }

    private static func validateCollection(_ value: Any) throws -> ValidatedCollection {
        let collection = try exactObject(
            value,
            required: ["format", "storageVersion", "revision", "activeVaultId", "vaults"],
            optional: ["recentMutationReceipts"],
            error: .invalidCollection
        )
        guard collection["format"] as? String == collectionFormat else {
            throw VaultageCoreError.invalidCollection
        }
        let storageVersion = try positiveInteger(collection["storageVersion"], error: .invalidCollection)
        guard storageVersion == 1 || storageVersion == 2 else {
            throw VaultageCoreError.unsupportedCollectionVersion
        }
        let revision = try positiveInteger(collection["revision"], error: .invalidCollection)
        let activeVaultID = try boundedText(
            collection["activeVaultId"],
            maximumUTF16Count: maximumIDCharacters,
            error: .invalidCollection
        )
        guard let entries = collection["vaults"] as? [Any],
              !entries.isEmpty,
              entries.count <= maximumVaults else {
            throw VaultageCoreError.invalidCollection
        }

        var seen = Set<String>()
        var validated: [ValidatedVaultEntry] = []
        validated.reserveCapacity(entries.count)
        for value in entries {
            let entry = try exactObject(
                value,
                required: ["id", "name", "createdAt", "updatedAt", "archived", "manifest"],
                optional: ["wrappedKey"],
                error: .invalidCollection
            )
            let id = try boundedText(
                entry["id"],
                maximumUTF16Count: maximumIDCharacters,
                error: .invalidCollection
            )
            guard seen.insert(id).inserted else { throw VaultageCoreError.invalidCollection }
            let name = try boundedText(
                entry["name"],
                maximumUTF16Count: maximumNameCharacters,
                error: .invalidCollection
            )
            let createdAt = try canonicalISODate(entry["createdAt"], error: .invalidCollection)
            let updatedAt = try canonicalISODate(entry["updatedAt"], error: .invalidCollection)
            guard updatedAt.date >= createdAt.date,
                  let archived = entry["archived"] as? Bool else {
                throw VaultageCoreError.invalidCollection
            }
            let wrappedKey: Data?
            if storageVersion == 2 {
                guard let wrappedKeyValue = entry["wrappedKey"] else { throw VaultageCoreError.invalidCollection }
                wrappedKey = try validateWrappedKey(wrappedKeyValue)
            } else if entry["wrappedKey"] != nil {
                throw VaultageCoreError.invalidCollection
            } else {
                wrappedKey = nil
            }
            let manifest = try validateRecordManifest(entry["manifest"] as Any)
            let projection = VaultListItem(
                id: id,
                name: name,
                createdAt: createdAt.text,
                updatedAt: updatedAt.text,
                isArchived: archived,
                recordStorageVersion: manifest.storageVersion,
                vaultVersion: manifest.vaultVersion,
                vaultRevision: manifest.revision
            )
            validated.append(ValidatedVaultEntry(
                projection: projection,
                wrappedKey: wrappedKey,
                manifest: manifest
            ))
        }

        guard let active = validated.first(where: { $0.projection.id == activeVaultID }),
              !active.projection.isArchived else {
            throw VaultageCoreError.invalidCollection
        }
        if let receipts = collection["recentMutationReceipts"] {
            try validateReceipts(receipts)
        }
        return ValidatedCollection(
            storageVersion: storageVersion,
            revision: revision,
            activeVaultID: activeVaultID,
            entries: validated
        )
    }

    private static func validateRecordManifest(_ value: Any) throws -> ValidatedRecordManifest {
        guard let manifest = value as? [String: Any],
              manifest["format"] as? String == recordStoreFormat else {
            throw VaultageCoreError.invalidRecordManifest
        }
        let storageVersion = try positiveInteger(manifest["storageVersion"], error: .invalidRecordManifest)
        guard storageVersion == 1 || storageVersion == 2 else {
            throw VaultageCoreError.invalidRecordManifest
        }
        let vaultVersion = try positiveInteger(manifest["vaultVersion"], error: .invalidRecordManifest)
        let revision = try manifest["revision"].map {
            try positiveInteger($0, error: .invalidRecordManifest)
        }
        let root = try recordID(manifest["root"], error: .invalidRecordManifest)
        let providers = try recordIDs(manifest["providers"], maximum: maximumProviders)
        let providerGroups = try recordIDs(manifest["providerGroups"], maximum: maximumProviderGroups)
        guard let providerGroupsPresent = manifest["providerGroupsPresent"] as? Bool else {
            throw VaultageCoreError.invalidRecordManifest
        }
        let envProjects = try recordIDs(manifest["envProjects"], maximum: maximumProjects)
        let preferences = try manifest["preferences"].map {
            try recordID($0, error: .invalidRecordManifest)
        }
        let extras = try manifest["extras"].map {
            try recordID($0, error: .invalidRecordManifest)
        }
        return ValidatedRecordManifest(
            storageVersion: storageVersion,
            vaultVersion: vaultVersion,
            revision: revision,
            root: root,
            providers: providers,
            providerGroups: providerGroups,
            providerGroupsPresent: providerGroupsPresent,
            envProjects: envProjects,
            preferences: preferences,
            extras: extras
        )
    }

    private static func validateWrappedKey(_ value: Any) throws -> Data {
        let envelope = try exactObject(
            value,
            required: ["format", "algorithm", "wrappedKey"],
            optional: [],
            error: .invalidCollection
        )
        guard envelope["format"] as? String == keyEnvelopeFormat,
              envelope["algorithm"] as? String == "aes-256-gcm",
              let encoded = envelope["wrappedKey"] as? String,
              let decoded = Data(base64Encoded: encoded),
              decoded.count == 60,
              decoded.base64EncodedString() == encoded else {
            throw VaultageCoreError.invalidCollection
        }
        return decoded
    }

    private static func validateReceipts(_ value: Any) throws {
        guard let receipts = value as? [Any], receipts.count <= maximumReceipts else {
            throw VaultageCoreError.invalidCollection
        }
        var seen = Set<String>()
        for value in receipts {
            let receipt = try exactObject(
                value,
                required: ["operationId", "expectedRevision", "revision", "type", "fingerprint", "targetVaultId", "result"],
                optional: [],
                error: .invalidCollection
            )
            let operationID = try boundedText(
                receipt["operationId"],
                maximumUTF16Count: maximumIDCharacters,
                error: .invalidCollection
            )
            guard seen.insert(operationID).inserted else { throw VaultageCoreError.invalidCollection }
            _ = try positiveInteger(receipt["expectedRevision"], error: .invalidCollection)
            let revision = try positiveInteger(receipt["revision"], error: .invalidCollection)
            guard let type = receipt["type"] as? String,
                  ["create", "switch", "rename", "archive", "delete"].contains(type),
                  let fingerprint = receipt["fingerprint"] as? String,
                  isRecordID(fingerprint) else {
                throw VaultageCoreError.invalidCollection
            }
            _ = try boundedText(
                receipt["targetVaultId"],
                maximumUTF16Count: maximumIDCharacters,
                error: .invalidCollection
            )
            let resultRevision = try validateReceiptResult(receipt["result"] as Any)
            guard resultRevision == revision else { throw VaultageCoreError.invalidCollection }
        }
    }

    private static func validateReceiptResult(_ value: Any) throws -> Int {
        let result = try exactObject(
            value,
            required: ["revision", "activeVaultId", "vaults"],
            optional: [],
            error: .invalidCollection
        )
        let revision = try positiveInteger(result["revision"], error: .invalidCollection)
        let activeID = try boundedText(
            result["activeVaultId"],
            maximumUTF16Count: maximumIDCharacters,
            error: .invalidCollection
        )
        guard let entries = result["vaults"] as? [Any],
              !entries.isEmpty,
              entries.count <= maximumVaults else {
            throw VaultageCoreError.invalidCollection
        }
        var seen = Set<String>()
        var activeArchived: Bool?
        for value in entries {
            let entry = try exactObject(
                value,
                required: ["id", "name", "createdAt", "updatedAt", "archived"],
                optional: [],
                error: .invalidCollection
            )
            let id = try boundedText(entry["id"], maximumUTF16Count: maximumIDCharacters, error: .invalidCollection)
            guard seen.insert(id).inserted else { throw VaultageCoreError.invalidCollection }
            _ = try boundedText(entry["name"], maximumUTF16Count: maximumNameCharacters, error: .invalidCollection)
            _ = try canonicalISODate(entry["createdAt"], error: .invalidCollection)
            _ = try canonicalISODate(entry["updatedAt"], error: .invalidCollection)
            guard let archived = entry["archived"] as? Bool else { throw VaultageCoreError.invalidCollection }
            if id == activeID { activeArchived = archived }
        }
        guard activeArchived == false else { throw VaultageCoreError.invalidCollection }
        return revision
    }

    private static func exactObject(
        _ value: Any,
        required: Set<String>,
        optional: Set<String>,
        error: VaultageCoreError
    ) throws -> [String: Any] {
        guard let object = value as? [String: Any] else { throw error }
        let keys = Set(object.keys)
        guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else { throw error }
        return object
    }

    static func positiveInteger(_ value: Any?, error: VaultageCoreError) throws -> Int {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue >= 1,
              number.doubleValue <= Double(maximumSafeInteger),
              number.doubleValue.rounded(.towardZero) == number.doubleValue else {
            throw error
        }
        return number.intValue
    }

    static func boundedText(
        _ value: Any?,
        maximumUTF16Count: Int,
        error: VaultageCoreError
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

    static func canonicalISODate(
        _ value: Any?,
        error: VaultageCoreError
    ) throws -> (text: String, date: Date) {
        guard let text = value as? String else { throw error }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: text), formatter.string(from: date) == text else { throw error }
        return (text, date)
    }

    private static func recordIDs(_ value: Any?, maximum: Int) throws -> [String] {
        guard let values = value as? [Any], values.count <= maximum else {
            throw VaultageCoreError.invalidRecordManifest
        }
        return try values.map { try recordID($0, error: .invalidRecordManifest) }
    }

    private static func recordID(_ value: Any?, error: VaultageCoreError) throws -> String {
        guard let value = value as? String, isRecordID(value) else { throw error }
        return value
    }

    static func isRecordID(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            ($0 >= Character("0").asciiValue! && $0 <= Character("9").asciiValue!)
                || ($0 >= Character("a").asciiValue! && $0 <= Character("f").asciiValue!)
        }
    }
}
