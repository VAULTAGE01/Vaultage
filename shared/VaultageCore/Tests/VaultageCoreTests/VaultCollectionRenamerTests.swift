import CryptoKit
import Foundation
import XCTest
@testable import VaultageCore

final class VaultCollectionRenamerTests: XCTestCase {
    private let key = Data(repeating: 0x42, count: 32)
    private let timestamp = "2026-08-25T13:00:00.000Z"

    func testRenamesOnlyTargetAndReturnsReaderCompatibleCollection() throws {
        let original = collection()
        var mutableKey = key
        let result = try rename(collection: original, key: &mutableKey)
        XCTAssertEqual(mutableKey, Data(repeating: 0, count: 32))
        XCTAssertEqual(
            result.metadata,
            VaultRenameMetadata(vaultID: "vault-alpha", name: "Renamed Vault", revision: 8)
        )

        let (plaintext, decrypted) = try decrypt(result.encryptedCollection)
        var expected = original
        expected["revision"] = 8
        var expectedVaults = expected["vaults"] as! [[String: Any]]
        expectedVaults[0]["name"] = "Renamed Vault"
        expectedVaults[0]["updatedAt"] = timestamp
        expected["vaults"] = expectedVaults
        XCTAssertEqual(
            plaintext,
            try JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys, .withoutEscapingSlashes])
        )
        let actualVaults = decrypted["vaults"] as! [[String: Any]]
        XCTAssertEqual(actualVaults[1]["name"] as? String, "Archive")
        XCTAssertEqual(actualVaults[1]["updatedAt"] as? String, "2026-08-25T12:02:00.000Z")
        let projection = try VaultCollectionReader.projectList(
            encryptedCollection: result.encryptedCollection,
            collectionKey: key
        )
        XCTAssertEqual(projection.revision, 8)
        XCTAssertEqual(projection.vaults.first(where: { $0.id == "vault-alpha" })?.name, "Renamed Vault")
    }

    func testRejectsUnknownCollectionEntryAndEnvelopeFields() throws {
        var unknownRoot = collection()
        unknownRoot["futureRoot"] = true
        var mutableKey = key
        assertThrows(.invalidCollection) { try rename(collection: unknownRoot, key: &mutableKey) }

        var unknownEntry = collection()
        var entries = unknownEntry["vaults"] as! [[String: Any]]
        entries[0]["futureEntry"] = true
        unknownEntry["vaults"] = entries
        mutableKey = key
        assertThrows(.invalidCollection) { try rename(collection: unknownEntry, key: &mutableKey) }

        var unknownEnvelope = collection()
        entries = unknownEnvelope["vaults"] as! [[String: Any]]
        var envelope = entries[0]["wrappedKey"] as! [String: Any]
        envelope["futureEnvelope"] = true
        entries[0]["wrappedKey"] = envelope
        unknownEnvelope["vaults"] = entries
        mutableKey = key
        assertThrows(.invalidCollection) { try rename(collection: unknownEnvelope, key: &mutableKey) }
    }

    func testNormalizesUnknownManifestFieldsLikeShippingValidator() throws {
        var input = collection()
        var entries = input["vaults"] as! [[String: Any]]
        var manifest = entries[0]["manifest"] as! [String: Any]
        manifest["futureManifest"] = ["unsupported": true]
        entries[0]["manifest"] = manifest
        input["vaults"] = entries
        var mutableKey = key
        let result = try rename(collection: input, key: &mutableKey)
        let decryptedEntries = try decrypt(result.encryptedCollection).1["vaults"] as! [[String: Any]]
        let normalizedManifest = decryptedEntries[0]["manifest"] as! [String: Any]
        XCTAssertNil(normalizedManifest["futureManifest"])
        XCTAssertNoThrow(try VaultCollectionReader.projectList(
            encryptedCollection: result.encryptedCollection,
            collectionKey: key
        ))
    }

    func testWrongKeyAndTamperingFailAuthenticationAndClearKey() throws {
        let encrypted = encrypt(collection())
        var wrongKey = Data(repeating: 0x41, count: 32)
        assertThrows(.authenticationFailed) {
            try VaultCollectionRenamer.renameCurrentV2Vault(
                encryptedCollection: encrypted,
                consumingCollectionKey: &wrongKey,
                targetVaultID: "vault-alpha",
                newName: "Renamed Vault",
                updatedAt: timestamp
            )
        }
        XCTAssertEqual(wrongKey, Data(repeating: 0, count: 32))

        var tampered = encrypted
        tampered[tampered.index(before: tampered.endIndex)] ^= 1
        var tamperKey = key
        assertThrows(.authenticationFailed) {
            try VaultCollectionRenamer.renameCurrentV2Vault(
                encryptedCollection: tampered,
                consumingCollectionKey: &tamperKey,
                targetVaultID: "vault-alpha",
                newName: "Renamed Vault",
                updatedAt: timestamp
            )
        }
        XCTAssertEqual(tamperKey, Data(repeating: 0, count: 32))
    }

    func testRejectsPublicIDNameAndTimestampBoundsBeforeConsumingKey() throws {
        for vaultID in ["", " vault-alpha", String(repeating: "v", count: 241)] {
            var mutableKey = key
            assertThrows(.invalidVaultID) {
                try rename(targetVaultID: vaultID, key: &mutableKey)
            }
            XCTAssertEqual(mutableKey, key)
        }
        for name in ["", " Renamed", String(repeating: "n", count: 513), "bad\nname"] {
            var mutableKey = key
            assertThrows(.invalidName) { try rename(newName: name, key: &mutableKey) }
            XCTAssertEqual(mutableKey, key)
        }
        for invalidTimestamp in [
            "2026-08-25T13:00:00Z",
            "2026-08-25T13:00:00.000+00:00",
            "2026-08-25T11:00:00.000Z",
        ] {
            var mutableKey = key
            assertThrows(.invalidTimestamp) {
                try rename(updatedAt: invalidTimestamp, key: &mutableKey)
            }
            if invalidTimestamp == "2026-08-25T11:00:00.000Z" {
                XCTAssertEqual(mutableKey, Data(repeating: 0, count: 32))
            } else {
                XCTAssertEqual(mutableKey, key)
            }
        }
    }

    func testRejectsMissingArchivedAndDuplicateVaultIDs() throws {
        var mutableKey = key
        assertThrows(.vaultMissing) {
            try rename(targetVaultID: "vault-missing", key: &mutableKey)
        }

        mutableKey = key
        assertThrows(.vaultArchived) {
            try rename(targetVaultID: "vault-archive", key: &mutableKey)
        }

        var duplicate = collection()
        var vaults = duplicate["vaults"] as! [[String: Any]]
        vaults[1]["id"] = "vault-alpha"
        duplicate["vaults"] = vaults
        mutableKey = key
        assertThrows(.duplicateVaultID) {
            try rename(collection: duplicate, key: &mutableKey)
        }
    }

    func testRejectsUnsupportedVersionAndRevisionOverflow() throws {
        var unsupported = collection()
        unsupported["storageVersion"] = 1
        var mutableKey = key
        assertThrows(.unsupportedCollectionVersion) {
            try rename(collection: unsupported, key: &mutableKey)
        }

        var overflow = collection()
        overflow["revision"] = 9_007_199_254_740_991
        mutableKey = key
        assertThrows(.revisionOverflow) {
            try rename(collection: overflow, key: &mutableKey)
        }
    }

    func testRejectsInvalidKeyLengthsAndClearsThem() throws {
        for length in [0, 31, 33] {
            var invalidKey = Data(repeating: 0x42, count: length)
            assertThrows(.invalidKey) { try rename(key: &invalidKey) }
            XCTAssertEqual(invalidKey, Data(repeating: 0, count: length))
        }
    }

    func testRejectsInvalidEnvelopeLengthsAndUnsupportedFutureVersion() throws {
        for length in [0, 28] {
            var mutableKey = key
            assertThrows(.invalidEnvelope) {
                try VaultCollectionRenamer.renameCurrentV2Vault(
                    encryptedCollection: Data(repeating: 0, count: length),
                    consumingCollectionKey: &mutableKey,
                    targetVaultID: "vault-alpha",
                    newName: "Renamed Vault",
                    updatedAt: timestamp
                )
            }
            XCTAssertEqual(mutableKey, Data(repeating: 0, count: 32))
        }

        var future = collection()
        future["storageVersion"] = 3
        var mutableKey = key
        assertThrows(.unsupportedCollectionVersion) {
            try rename(collection: future, key: &mutableKey)
        }
    }

    func testAcceptsExactMaximumBoundedName() throws {
        let maximumName = String(repeating: "n", count: 512)
        var mutableKey = key
        let result = try rename(newName: maximumName, key: &mutableKey)
        XCTAssertEqual(result.metadata.name, maximumName)
        XCTAssertEqual((try decrypt(result.encryptedCollection).1["vaults"] as! [[String: Any]])[0]["name"] as? String, maximumName)
    }

    func testEverySuccessfulRenameUsesFreshNonce() throws {
        let encrypted = encrypt(collection())
        var firstKey = key
        let first = try VaultCollectionRenamer.renameCurrentV2Vault(
            encryptedCollection: encrypted,
            consumingCollectionKey: &firstKey,
            targetVaultID: "vault-alpha",
            newName: "Renamed Vault",
            updatedAt: timestamp
        )
        var secondKey = key
        let second = try VaultCollectionRenamer.renameCurrentV2Vault(
            encryptedCollection: encrypted,
            consumingCollectionKey: &secondKey,
            targetVaultID: "vault-alpha",
            newName: "Renamed Vault",
            updatedAt: timestamp
        )
        XCTAssertNotEqual(first.encryptedCollection.prefix(12), second.encryptedCollection.prefix(12))
        XCTAssertNotEqual(first.encryptedCollection, second.encryptedCollection)
        XCTAssertEqual(try decrypt(first.encryptedCollection).1 as NSDictionary, try decrypt(second.encryptedCollection).1 as NSDictionary)
    }

    func testCancelledTaskFailsBeforeConsumingKey() async throws {
        let encrypted = encrypt(collection())
        let task = Task.detached { () -> (VaultRenameError?, Data) in
            while !Task.isCancelled { await Task.yield() }
            var mutableKey = Data(repeating: 0x42, count: 32)
            do {
                _ = try VaultCollectionRenamer.renameCurrentV2Vault(
                    encryptedCollection: encrypted,
                    consumingCollectionKey: &mutableKey,
                    targetVaultID: "vault-alpha",
                    newName: "Renamed Vault",
                    updatedAt: "2026-08-25T13:00:00.000Z"
                )
                return (nil, mutableKey)
            } catch {
                return (error as? VaultRenameError, mutableKey)
            }
        }
        task.cancel()
        let (error, returnedKey) = await task.value
        XCTAssertEqual(error, .cancelled)
        XCTAssertEqual(returnedKey, key)
    }

    private func rename(
        collection: [String: Any]? = nil,
        targetVaultID: String = "vault-alpha",
        newName: String = "Renamed Vault",
        updatedAt: String? = nil,
        key mutableKey: inout Data
    ) throws -> VaultRenameResult {
        try VaultCollectionRenamer.renameCurrentV2Vault(
            encryptedCollection: encrypt(collection ?? self.collection()),
            consumingCollectionKey: &mutableKey,
            targetVaultID: targetVaultID,
            newName: newName,
            updatedAt: updatedAt ?? timestamp
        )
    }

    private func collection() -> [String: Any] {
        [
            "format": "vaultage.vault-collection.v1",
            "storageVersion": 2,
            "revision": 7,
            "activeVaultId": "vault-alpha",
            "vaults": [
                entry(id: "vault-alpha", name: "Personal", archived: false, seed: "a"),
                entry(id: "vault-archive", name: "Archive", archived: true, seed: "b"),
            ],
        ]
    }

    private func entry(id: String, name: String, archived: Bool, seed: String) -> [String: Any] {
        [
            "id": id,
            "name": name,
            "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": id == "vault-alpha" ? "2026-08-25T12:01:00.000Z" : "2026-08-25T12:02:00.000Z",
            "archived": archived,
            "manifest": [
                "format": "vaultage.record-store.v1",
                "storageVersion": 2,
                "vaultVersion": 2,
                "revision": 9,
                "root": String(repeating: seed, count: 64),
                "providers": [],
                "providerGroups": [],
                "providerGroupsPresent": true,
                "envProjects": [],
            ],
            "wrappedKey": [
                "format": "vaultage.vault-key-envelope.v1",
                "algorithm": "aes-256-gcm",
                "wrappedKey": Data(repeating: 0x21, count: 60).base64EncodedString(),
            ],
        ]
    }

    private func encrypt(_ collection: [String: Any]) -> Data {
        let plaintext = try! JSONSerialization.data(withJSONObject: collection, options: [.sortedKeys, .withoutEscapingSlashes])
        let nonce = try! AES.GCM.Nonce(data: Data(repeating: 0x11, count: 12))
        let sealed = try! AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce)
        var envelope = Data(nonce)
        envelope.append(sealed.tag)
        envelope.append(sealed.ciphertext)
        return envelope
    }

    private func decrypt(_ encrypted: Data) throws -> (Data, [String: Any]) {
        let nonce = try AES.GCM.Nonce(data: encrypted.prefix(12))
        let sealed = try AES.GCM.SealedBox(
            nonce: nonce,
            ciphertext: encrypted.dropFirst(28),
            tag: encrypted.dropFirst(12).prefix(16)
        )
        let plaintext = try AES.GCM.open(sealed, using: SymmetricKey(data: key))
        return (plaintext, try JSONSerialization.jsonObject(with: plaintext) as! [String: Any])
    }

    private func assertThrows<T>(
        _ expected: VaultRenameError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? VaultRenameError, expected, file: file, line: line)
        }
    }
}
