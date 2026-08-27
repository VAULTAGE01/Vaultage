import CryptoKit
import Foundation
import XCTest
@testable import VaultageCore

final class VaultCollectionReaderTests: XCTestCase {
    private let key = Data(repeating: 0x42, count: 32)

    func testProjectsCurrentMultiVaultMetadata() throws {
        let projection = try VaultCollectionReader.projectList(
            encryptedCollection: encrypt(collection: collection()),
            collectionKey: key
        )

        XCTAssertEqual(projection.storageVersion, 2)
        XCTAssertEqual(projection.revision, 7)
        XCTAssertEqual(projection.activeVaultID, "vault-alpha")
        XCTAssertEqual(projection.vaults.map(\.name), ["Personal", "Archive"])
        XCTAssertEqual(projection.vaults[0].recordStorageVersion, 2)
        XCTAssertEqual(projection.vaults[0].vaultVersion, 2)
        XCTAssertEqual(projection.vaults[0].vaultRevision, 9)
        XCTAssertTrue(projection.vaults[1].isArchived)
    }

    func testRejectsWrongKeyAndTampering() throws {
        let encrypted = encrypt(collection: collection())
        assertThrows(.authenticationFailed) {
            try VaultCollectionReader.projectList(
                encryptedCollection: encrypted,
                collectionKey: Data(repeating: 0x41, count: 32)
            )
        }
        var tampered = encrypted
        tampered[tampered.index(before: tampered.endIndex)] ^= 0x01
        assertThrows(.authenticationFailed) {
            try VaultCollectionReader.projectList(encryptedCollection: tampered, collectionKey: key)
        }
    }

    func testRejectsMissingV2WrappedKeyAndUnexpectedProperties() throws {
        var missing = collection()
        var entries = missing["vaults"] as! [[String: Any]]
        entries[0].removeValue(forKey: "wrappedKey")
        missing["vaults"] = entries
        assertThrows(.invalidCollection) {
            try VaultCollectionReader.projectList(encryptedCollection: encrypt(collection: missing), collectionKey: key)
        }

        var unsupported = collection()
        unsupported["plaintext"] = "forbidden"
        assertThrows(.invalidCollection) {
            try VaultCollectionReader.projectList(encryptedCollection: encrypt(collection: unsupported), collectionKey: key)
        }
    }

    func testAcceptsLegacyV1WithoutWrappedKeys() throws {
        var legacy = collection()
        legacy["storageVersion"] = 1
        var entries = legacy["vaults"] as! [[String: Any]]
        for index in entries.indices {
            entries[index].removeValue(forKey: "wrappedKey")
            var manifest = entries[index]["manifest"] as! [String: Any]
            manifest["storageVersion"] = 1
            entries[index]["manifest"] = manifest
        }
        legacy["vaults"] = entries
        let projection = try VaultCollectionReader.projectList(
            encryptedCollection: encrypt(collection: legacy),
            collectionKey: key
        )
        XCTAssertEqual(projection.storageVersion, 1)
        XCTAssertTrue(projection.vaults.allSatisfy { $0.recordStorageVersion == 1 })
    }

    func testRejectsUnavailableActiveVaultAndMalformedManifest() throws {
        var unavailable = collection()
        unavailable["activeVaultId"] = "vault-archive"
        assertThrows(.invalidCollection) {
            try VaultCollectionReader.projectList(encryptedCollection: encrypt(collection: unavailable), collectionKey: key)
        }

        var malformed = collection()
        var entries = malformed["vaults"] as! [[String: Any]]
        var manifest = entries[0]["manifest"] as! [String: Any]
        manifest["root"] = String(repeating: "G", count: 64)
        entries[0]["manifest"] = manifest
        malformed["vaults"] = entries
        assertThrows(.invalidRecordManifest) {
            try VaultCollectionReader.projectList(encryptedCollection: encrypt(collection: malformed), collectionKey: key)
        }
    }

    private func assertThrows<T>(
        _ expected: VaultageCoreError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? VaultageCoreError, expected, file: file, line: line)
        }
    }

    private func collection() -> [String: Any] {
        [
            "format": "vaultage.vault-collection.v1",
            "storageVersion": 2,
            "revision": 7,
            "activeVaultId": "vault-alpha",
            "vaults": [
                entry(id: "vault-alpha", name: "Personal", archived: false, recordSeed: "a"),
                entry(id: "vault-archive", name: "Archive", archived: true, recordSeed: "b"),
            ],
        ]
    }

    private func entry(id: String, name: String, archived: Bool, recordSeed: String) -> [String: Any] {
        [
            "id": id,
            "name": name,
            "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:01:00.000Z",
            "archived": archived,
            "manifest": [
                "format": "vaultage.record-store.v1",
                "storageVersion": 2,
                "vaultVersion": 2,
                "revision": 9,
                "root": String(repeating: recordSeed, count: 64),
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

    private func encrypt(collection: [String: Any]) -> Data {
        let plaintext = try! JSONSerialization.data(withJSONObject: collection, options: [.sortedKeys])
        let nonce = try! AES.GCM.Nonce(data: Data(repeating: 0x11, count: 12))
        let box = try! AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce)
        var nodeEnvelope = Data(nonce)
        nodeEnvelope.append(box.tag)
        nodeEnvelope.append(box.ciphertext)
        return nodeEnvelope
    }
}
