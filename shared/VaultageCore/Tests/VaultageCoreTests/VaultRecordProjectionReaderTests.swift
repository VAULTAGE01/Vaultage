import CryptoKit
import Foundation
import XCTest
@testable import VaultageCore

final class VaultRecordProjectionReaderTests: XCTestCase {
    private let collectionKey = Data(repeating: 0x42, count: 32)
    private let vaultKey = Data(repeating: 0x61, count: 32)
    private let vaultID = "vault-alpha"

    func testProjectsCurrentV2NestedCredentialMetadataWithoutValues() throws {
        let fixture = try currentV2Fixture()
        let projection = try project(fixture)

        XCTAssertEqual(projection.vaultID, vaultID)
        XCTAssertEqual(projection.vaultName, "Personal")
        XCTAssertEqual(projection.credentials.count, 1)
        let credential = try XCTUnwrap(projection.credentials.first)
        XCTAssertEqual(credential.id, "secret-production")
        XCTAssertEqual(credential.name, "Production Password")
        XCTAssertEqual(credential.type, "password")
        XCTAssertEqual(credential.createdAt, "2026-08-25T12:00:00.000Z")
        XCTAssertEqual(credential.updatedAt, "2026-08-25T12:01:00.000Z")
        XCTAssertEqual(credential.folderPath, ["Personal", "Engineering"])
        XCTAssertEqual(credential.fieldCount, 2)

        // Neither a secret field value nor notes may cross this list boundary.
        XCTAssertFalse(String(reflecting: projection).contains(fixture.secretSentinel))
        XCTAssertFalse(String(reflecting: projection).contains(fixture.noteSentinel))
    }

    func testReadsLegacyV1CollectionAndDirectRecord() throws {
        let fixture = try legacyV1Fixture()
        let projection = try project(fixture)

        XCTAssertEqual(projection.vaultID, vaultID)
        XCTAssertEqual(projection.vaultName, "Personal")
        XCTAssertEqual(projection.credentials.map(\.name), ["Legacy Password"])
        XCTAssertEqual(projection.credentials.first?.folderPath, ["Personal"])
        XCTAssertEqual(projection.credentials.first?.fieldCount, 1)
    }

    func testRejectsV2WrapperAuthenticatedForAnotherVaultID() throws {
        let fixture = try currentV2Fixture(wrappedForVaultID: "vault-beta")
        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsTamperedRecordAEADCiphertext() throws {
        var fixture = try currentV2Fixture()
        var blob = try XCTUnwrap(fixture.recordBlobs[fixture.rootRecordID])
        blob[blob.index(before: blob.endIndex)] ^= 0x01
        fixture.recordBlobs[fixture.rootRecordID] = blob

        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsRecordContentIDMismatchAfterValidAEAD() throws {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let forgedID = String(repeating: "e", count: 64)
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: []),
            storageVersion: 2,
            forcedID: forgedID
        )
        let fixture = Fixture(
            encryptedCollection: try builder.collection(
                vaultID: vaultID,
                vaultName: "Personal",
                manifest: manifest(storageVersion: 2, root: rootID),
                wrappedForVaultID: vaultID
            ),
            vaultID: vaultID,
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            secretSentinel: "record-content-id-sentinel",
            noteSentinel: "record-content-id-note"
        )

        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsRecordStorageVersionMismatch() throws {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: []),
            storageVersion: 1
        )
        let fixture = Fixture(
            encryptedCollection: try builder.collection(
                vaultID: vaultID,
                vaultName: "Personal",
                manifest: manifest(storageVersion: 2, root: rootID),
                wrappedForVaultID: vaultID
            ),
            vaultID: vaultID,
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            secretSentinel: "storage-version-sentinel",
            noteSentinel: "storage-version-note"
        )

        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsMissingReferencedRecord() throws {
        var fixture = try currentV2Fixture()
        fixture.recordBlobs.removeValue(forKey: fixture.rootRecordID)
        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsRecordKindMismatch() throws {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let rootID = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-root",
                name: "Wrong Kind",
                fields: [field(key: "password", value: "wrong-kind-sentinel")],
                notes: "wrong-kind-note"
            ),
            storageVersion: 2
        )
        let fixture = Fixture(
            encryptedCollection: try builder.collection(
                vaultID: vaultID,
                vaultName: "Personal",
                manifest: manifest(storageVersion: 2, root: rootID),
                wrappedForVaultID: vaultID
            ),
            vaultID: vaultID,
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            secretSentinel: "wrong-kind-sentinel",
            noteSentinel: "wrong-kind-note"
        )

        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsFolderCycleShapedRecord() throws {
        // A real self-cycle cannot have a valid 256-bit content ID because the
        // ID commits to its own child reference. The forged ID still gives the
        // reader a cyclic graph shape; a correct reader must reject it (at its
        // content-ID check before traversal, or its folder-cycle check).
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let forgedID = String(repeating: "f", count: 64)
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [forgedID], secrets: []),
            storageVersion: 2,
            forcedID: forgedID
        )
        let fixture = Fixture(
            encryptedCollection: try builder.collection(
                vaultID: vaultID,
                vaultName: "Personal",
                manifest: manifest(storageVersion: 2, root: rootID),
                wrappedForVaultID: vaultID
            ),
            vaultID: vaultID,
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            secretSentinel: "folder-cycle-sentinel",
            noteSentinel: "folder-cycle-note"
        )

        assertRejected { _ = try self.project(fixture) }
    }

    func testRejectsCredentialExceedingFieldBound() throws {
        let fields = (0...256).map { index in
            field(key: "field-\(index)", value: "field-bound-sentinel-\(index)")
        }
        let fixture = try currentV2Fixture(fields: fields)
        assertRejected { _ = try self.project(fixture) }
    }

    func testAcceptsMissingLegacyFolderCollectionsAsEmptyInV1AndV2() throws {
        for storageVersion in [1, 2] {
            let recordKey = storageVersion == 1 ? collectionKey : vaultKey
            let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: recordKey)
            let rootID = try builder.addRecord(
                kind: "folder",
                value: ["metadata": ["id": "folder-root", "name": "Personal"]],
                storageVersion: storageVersion
            )
            let fixture = Fixture(
                encryptedCollection: try builder.collection(
                    vaultID: vaultID,
                    vaultName: "Personal",
                    manifest: manifest(storageVersion: storageVersion, root: rootID),
                    collectionStorageVersion: storageVersion
                ),
                vaultID: vaultID,
                rootRecordID: rootID,
                recordBlobs: builder.recordBlobs,
                secretSentinel: "missing-collections-sentinel",
                noteSentinel: "missing-collections-note"
            )

            XCTAssertEqual(try project(fixture).credentials, [])
        }
    }

    private func project(_ fixture: Fixture) throws -> CredentialListProjection {
        try VaultRecordProjectionReader.projectCredentialList(
            encryptedCollection: fixture.encryptedCollection,
            collectionKey: collectionKey,
            vaultID: fixture.vaultID,
            loadRecordBlob: { recordID in
                guard let blob = fixture.recordBlobs[recordID] else {
                    throw FixtureError.missingRecord
                }
                return blob
            }
        )
    }

    private func currentV2Fixture(
        wrappedForVaultID: String? = nil,
        fields: [[String: Any]]? = nil
    ) throws -> Fixture {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let secretSentinel = "current-v2-credential-value-sentinel"
        let noteValue = "current-v2-note-sentinel"
        let secretID = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-production",
                name: "Production Password",
                fields: fields ?? [
                    field(key: "username", value: "operator@example.test", sensitive: false),
                    field(key: "password", value: secretSentinel),
                ],
                notes: noteValue
            ),
            storageVersion: 2
        )
        let childID = try builder.addRecord(
            kind: "folder",
            value: folderValue(
                id: "folder-engineering",
                name: "Engineering",
                children: [],
                secrets: [secretID]
            ),
            storageVersion: 2
        )
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(
                id: "folder-root",
                name: "Personal",
                children: [childID],
                secrets: []
            ),
            storageVersion: 2
        )
        return Fixture(
            encryptedCollection: try builder.collection(
                vaultID: vaultID,
                vaultName: "Personal",
                manifest: manifest(storageVersion: 2, root: rootID),
                wrappedForVaultID: wrappedForVaultID ?? vaultID
            ),
            vaultID: vaultID,
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            secretSentinel: secretSentinel,
            noteSentinel: noteValue
        )
    }

    private func legacyV1Fixture() throws -> Fixture {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: collectionKey)
        let secretID = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-legacy",
                name: "Legacy Password",
                fields: [field(key: "password", value: "legacy-v1-sentinel")],
                notes: "legacy-v1-note"
            ),
            storageVersion: 1
        )
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [secretID]),
            storageVersion: 1
        )
        return Fixture(
            encryptedCollection: try builder.collection(
                vaultID: vaultID,
                vaultName: "Personal",
                manifest: manifest(storageVersion: 1, root: rootID),
                collectionStorageVersion: 1
            ),
            vaultID: vaultID,
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            secretSentinel: "legacy-v1-sentinel",
            noteSentinel: "legacy-v1-note"
        )
    }

    private func manifest(storageVersion: Int, root: String) -> [String: Any] {
        [
            "format": "vaultage.record-store.v1",
            "storageVersion": storageVersion,
            "vaultVersion": 2,
            "revision": 9,
            "root": root,
            "providers": [],
            "providerGroups": [],
            "providerGroupsPresent": true,
            "envProjects": [],
        ]
    }

    private func folderValue(id: String, name: String, children: [String], secrets: [String]) -> [String: Any] {
        [
            "metadata": ["id": id, "name": name],
            "children": children,
            "secrets": secrets,
        ]
    }

    private func secretValue(
        id: String,
        name: String,
        fields: [[String: Any]],
        notes: String
    ) -> [String: Any] {
        [
            "id": id,
            "name": name,
            "type": "password",
            "fields": fields,
            "notes": notes,
            "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:01:00.000Z",
        ]
    }

    private func field(key: String, value: String, sensitive: Bool = true) -> [String: Any] {
        ["key": key, "value": value, "sensitive": sensitive]
    }

    private func assertRejected(
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> Void
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line)
    }
}

private struct Fixture {
    let encryptedCollection: Data
    let vaultID: String
    let rootRecordID: String
    var recordBlobs: [String: Data]
    let secretSentinel: String
    let noteSentinel: String
}

private enum FixtureError: Error {
    case missingRecord
}

private final class FixtureBuilder {
    private static let entryKeyDomain = Data("vaultage.vault-entry-key.aad.v1\0".utf8)
    private static let recordMagic = Data("VLTREC02".utf8)
    private let collectionKey: Data
    private let vaultKey: Data
    private var nonceByte: UInt8 = 0x10
    var recordBlobs: [String: Data] = [:]

    init(collectionKey: Data, vaultKey: Data) {
        self.collectionKey = collectionKey
        self.vaultKey = vaultKey
    }

    func collection(
        vaultID: String,
        vaultName: String,
        manifest: [String: Any],
        collectionStorageVersion: Int = 2,
        wrappedForVaultID: String? = nil
    ) throws -> Data {
        var entry: [String: Any] = [
            "id": vaultID,
            "name": vaultName,
            "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:01:00.000Z",
            "archived": false,
            "manifest": manifest,
        ]
        if collectionStorageVersion == 2 {
            let keyID = wrappedForVaultID ?? vaultID
            entry["wrappedKey"] = [
                "format": "vaultage.vault-key-envelope.v1",
                "algorithm": "aes-256-gcm",
                "wrappedKey": try seal(
                    vaultKey,
                    key: collectionKey,
                    aad: Self.entryKeyDomain + Data(keyID.utf8)
                ).base64EncodedString(),
            ]
        }
        let value: [String: Any] = [
            "format": "vaultage.vault-collection.v1",
            "storageVersion": collectionStorageVersion,
            "revision": 7,
            "activeVaultId": vaultID,
            "vaults": [entry],
        ]
        return try seal(canonicalJSON(value), key: collectionKey)
    }

    func addRecord(
        kind: String,
        value: [String: Any],
        storageVersion: Int,
        forcedID: String? = nil
    ) throws -> String {
        let canonical = try canonicalJSON([
            "format": "vaultage.record.v1",
            "kind": kind,
            "value": value,
        ])
        let computedID = hex(hmac(
            purposeKey(vaultKey, "vaultage-record-index-v\(storageVersion)"),
            canonical
        ))
        let recordID = forcedID ?? computedID
        let plaintext = storageVersion == 2 ? pad(canonical) : canonical
        recordBlobs[recordID] = try seal(
            plaintext,
            key: purposeKey(vaultKey, "vaultage-record-encryption-v1\0\(recordID)")
        )
        return recordID
    }

    private func seal(_ plaintext: Data, key: Data, aad: Data? = nil) throws -> Data {
        defer { nonceByte &+= 1 }
        let nonce = try AES.GCM.Nonce(data: Data(repeating: nonceByte, count: 12))
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce, authenticating: aad ?? Data())
        var envelope = Data(nonce)
        envelope.append(box.tag)
        envelope.append(box.ciphertext)
        return envelope
    }

    private func pad(_ canonical: Data) -> Data {
        let headerBytes = Self.recordMagic.count + MemoryLayout<UInt32>.size
        let size = ((headerBytes + canonical.count + 255) / 256) * 256
        var result = Data(repeating: 0, count: size)
        result.replaceSubrange(0..<Self.recordMagic.count, with: Self.recordMagic)
        var length = UInt32(canonical.count).bigEndian
        withUnsafeBytes(of: &length) { bytes in
            result.replaceSubrange(Self.recordMagic.count..<headerBytes, with: bytes)
        }
        result.replaceSubrange(headerBytes..<(headerBytes + canonical.count), with: canonical)
        return result
    }
}

private func canonicalJSON(_ value: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
}

private func hmac(_ key: Data, _ value: Data) -> Data {
    Data(HMAC<SHA256>.authenticationCode(for: value, using: SymmetricKey(data: key)))
}

private func purposeKey(_ vaultKey: Data, _ purpose: String) -> Data {
    hmac(vaultKey, Data(purpose.utf8))
}

private func hex(_ value: Data) -> String {
    value.map { String(format: "%02x", $0) }.joined()
}
