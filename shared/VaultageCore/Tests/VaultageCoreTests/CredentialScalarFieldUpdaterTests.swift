import CryptoKit
import Foundation
import XCTest
@testable import VaultageCore

final class CredentialScalarFieldUpdaterTests: XCTestCase {
    private let timestamp = "2026-08-25T16:00:00.000Z"

    func testStableFieldUpdateRekeysCredentialAndAncestorsOnly() throws {
        let fixture = try Fixture()
        var key = fixture.collectionKey
        var value = Data("rotated-value".utf8)
        let result = try fixture.update(key: &key, value: &value)

        XCTAssertEqual(key, Data(repeating: 0, count: 32))
        XCTAssertEqual(value, Data(repeating: 0, count: "rotated-value".utf8.count))
        XCTAssertEqual(result.metadata.collectionRevision, 8)
        XCTAssertEqual(result.metadata.vaultRevision, 10)
        XCTAssertEqual(result.metadata.fieldID, "field-password")
        XCTAssertEqual(result.recordBlobs.count, 3)
        XCTAssertNotEqual(result.encryptedCollection.prefix(12), fixture.encryptedCollection.prefix(12))

        let opened = try fixture.openResult(result)
        XCTAssertEqual(opened.collectionRevision, 8)
        XCTAssertEqual(opened.vaultRevision, 10)
        XCTAssertEqual(opened.entryUpdatedAt, timestamp)
        XCTAssertEqual(opened.secret["updatedAt"] as? String, timestamp)
        let fields = opened.secret["fields"] as! [[String: Any]]
        XCTAssertEqual(fields[0]["value"] as? String, "operator@example.test")
        XCTAssertEqual(fields[1]["value"] as? String, "rotated-value")
        XCTAssertEqual(fields[2]["value"] as? String, "legacy-value")
        XCTAssertEqual((opened.secret["opaqueSecret"] as? [String: Any])?["marker"] as? String, "kept")
        XCTAssertEqual(opened.siblingRecordID, fixture.siblingRecordID)
        XCTAssertNil(result.recordBlobs[fixture.siblingRecordID])
        XCTAssertEqual(fixture.records[fixture.siblingRecordID], opened.allRecords[fixture.siblingRecordID])
        XCTAssertEqual(opened.rootOpaque, "root-kept")
        XCTAssertEqual(opened.childOpaque, "child-kept")

        let detail = try VaultRecordProjectionReader.projectCredentialDetail(
            encryptedCollection: result.encryptedCollection,
            collectionKey: fixture.collectionKey,
            vaultID: fixture.vaultID,
            credentialID: fixture.selector.credentialID,
            loadRecordBlob: { id in
                guard let blob = opened.allRecords[id] else { throw CocoaError(.fileNoSuchFile) }
                return blob
            }
        )
        XCTAssertEqual(detail.credential.updatedAt, timestamp)
        let released = try VaultRecordProjectionReader.releaseCredentialField(
            encryptedCollection: result.encryptedCollection,
            collectionKey: fixture.collectionKey,
            vaultID: fixture.vaultID,
            selector: CredentialFieldSelector(
                credentialID: fixture.selector.credentialID,
                fieldID: fixture.selector.fieldID,
                position: 1,
                key: fixture.selector.key
            ),
            loadRecordBlob: { id in
                guard let blob = opened.allRecords[id] else { throw CocoaError(.fileNoSuchFile) }
                return blob
            }
        )
        XCTAssertEqual(try released.withUTF8String { $0 }, "rotated-value")
        released.invalidate()
    }

    func testUniqueLegacyKeyFallbackUpdatesOnlyLegacyField() throws {
        let fixture = try Fixture()
        var key = fixture.collectionKey
        var value = Data("legacy-rotated".utf8)
        let result = try fixture.update(
            selector: .init(credentialID: "credential-target", fieldID: nil, key: "legacy"),
            key: &key,
            value: &value
        )
        XCTAssertNil(result.metadata.fieldID)
        let fields = try fixture.openResult(result).secret["fields"] as! [[String: Any]]
        XCTAssertEqual(fields[1]["value"] as? String, "old-password")
        XCTAssertEqual(fields[2]["value"] as? String, "legacy-rotated")
    }

    func testWrongCollectionKeyAndTamperedCollectionFailClosed() throws {
        let fixture = try Fixture()
        var wrong = Data(repeating: 0x99, count: 32)
        var value = Data("next".utf8)
        assertThrows(.authenticationFailed) { try fixture.update(key: &wrong, value: &value) }
        XCTAssertEqual(wrong, Data(repeating: 0, count: 32))
        XCTAssertEqual(value, Data(repeating: 0, count: 4))

        var tampered = fixture.encryptedCollection
        tampered[tampered.index(before: tampered.endIndex)] ^= 1
        var key = fixture.collectionKey
        value = Data("next".utf8)
        assertThrows(.authenticationFailed) {
            try CredentialScalarFieldUpdater.updateCurrentV2CredentialScalarField(
                encryptedCollection: tampered,
                consumingCollectionKey: &key,
                vaultID: fixture.vaultID,
                selector: fixture.selector,
                consumingUTF8Value: &value,
                updatedAt: timestamp,
                loadRecordBlob: fixture.load
            )
        }
    }

    func testTamperedOrMissingReferencedRecordFailsClosed() throws {
        let fixture = try Fixture()
        var tamperedRecords = fixture.records
        var tampered = tamperedRecords[fixture.siblingRecordID]!
        tampered[tampered.index(before: tampered.endIndex)] ^= 1
        tamperedRecords[fixture.siblingRecordID] = tampered
        var key = fixture.collectionKey
        var value = Data("next".utf8)
        assertThrows(.recordAuthenticationFailed) {
            try fixture.update(key: &key, value: &value, records: tamperedRecords)
        }

        var missing = fixture.records
        missing.removeValue(forKey: fixture.siblingRecordID)
        key = fixture.collectionKey
        value = Data("next".utf8)
        assertThrows(.recordMissing) {
            try fixture.update(key: &key, value: &value, records: missing)
        }
    }

    func testRejectsStaleMissingAndAmbiguousSelectors() throws {
        let fixture = try Fixture()
        for (selector, expected) in [
            (CredentialScalarFieldUpdateSelector(credentialID: "credential-target", fieldID: "missing", key: "password"), .fieldNotFound),
            (CredentialScalarFieldUpdateSelector(credentialID: "credential-target", fieldID: "field-password", key: "stale"), .invalidSelector),
            (CredentialScalarFieldUpdateSelector(credentialID: "missing-credential", fieldID: "field-password", key: "password"), .credentialNotFound),
        ] as [(CredentialScalarFieldUpdateSelector, CredentialFieldUpdateError)] {
            var key = fixture.collectionKey
            var value = Data("next".utf8)
            assertThrows(expected) { try fixture.update(selector: selector, key: &key, value: &value) }
        }

        let ambiguous = try Fixture(duplicateLegacyKey: true)
        var key = ambiguous.collectionKey
        var value = Data("next".utf8)
        assertThrows(.ambiguousLegacyField) {
            try ambiguous.update(
                selector: .init(credentialID: "credential-target", fieldID: nil, key: "legacy"),
                key: &key,
                value: &value
            )
        }
    }

    func testRevealPolicyAndNonScalarCredentialTypesDenyEdits() throws {
        let fixtures = [
            try Fixture(revealAllowed: false),
            try Fixture(secretType: "image"),
            try Fixture(secretType: "certificate"),
            try Fixture(secretType: "secureNote"),
        ]
        for fixture in fixtures {
            var key = fixture.collectionKey
            var value = Data("next".utf8)
            assertThrows(.editDenied) { try fixture.update(key: &key, value: &value) }
        }
    }

    func testInputBoundsAndCanonicalTimestampFailWithTypedErrors() throws {
        let fixture = try Fixture()
        for vaultID in ["", " vault-main", String(repeating: "v", count: 241)] {
            var key = fixture.collectionKey
            var value = Data("next".utf8)
            assertThrows(.invalidVaultID) {
                try fixture.update(vaultID: vaultID, key: &key, value: &value)
            }
            XCTAssertEqual(key, fixture.collectionKey)
            XCTAssertEqual(value, Data("next".utf8))
        }

        var key = fixture.collectionKey
        var invalidUTF8 = Data([0xff])
        assertThrows(.invalidValue) { try fixture.update(key: &key, value: &invalidUTF8) }
        XCTAssertEqual(key, Data(repeating: 0, count: 32))
        XCTAssertEqual(invalidUTF8, Data([0]))

        key = fixture.collectionKey
        var oversized = Data(repeating: 0x61, count: 2 * 1024 * 1024 + 1)
        assertThrows(.invalidValue) { try fixture.update(key: &key, value: &oversized) }
        XCTAssertTrue(oversized.allSatisfy { $0 == 0 })

        key = fixture.collectionKey
        var value = Data("next".utf8)
        assertThrows(.invalidTimestamp) {
            try fixture.update(updatedAt: "2026-08-25T16:00:00Z", key: &key, value: &value)
        }
        XCTAssertEqual(key, fixture.collectionKey)

        key = fixture.collectionKey
        value = Data("next".utf8)
        assertThrows(.invalidTimestamp) {
            try fixture.update(updatedAt: "2026-08-25T11:59:59.000Z", key: &key, value: &value)
        }
        XCTAssertEqual(key, Data(repeating: 0, count: 32))
    }

    func testRejectsArchivedUnsupportedAndRevisionOverflow() throws {
        for (fixture, expected) in [
            (try Fixture(archived: true), CredentialFieldUpdateError.vaultArchived),
            (try Fixture(recordStorageVersion: 1), .unsupportedCollectionVersion),
            (try Fixture(collectionRevision: 9_007_199_254_740_991), .revisionOverflow),
            (try Fixture(vaultRevision: 9_007_199_254_740_991), .revisionOverflow),
        ] {
            var key = fixture.collectionKey
            var value = Data("next".utf8)
            assertThrows(expected) { try fixture.update(key: &key, value: &value) }
        }
    }

    func testRepeatedUpdatesUseFreshCollectionAndRecordNonces() throws {
        let fixture = try Fixture()
        var firstKey = fixture.collectionKey
        var firstValue = Data("same-value".utf8)
        let first = try fixture.update(key: &firstKey, value: &firstValue)
        var secondKey = fixture.collectionKey
        var secondValue = Data("same-value".utf8)
        let second = try fixture.update(key: &secondKey, value: &secondValue)
        XCTAssertNotEqual(first.encryptedCollection.prefix(12), second.encryptedCollection.prefix(12))
        XCTAssertEqual(Set(first.recordBlobs.keys), Set(second.recordBlobs.keys))
        for id in first.recordBlobs.keys {
            XCTAssertNotEqual(first.recordBlobs[id]!.prefix(12), second.recordBlobs[id]!.prefix(12))
        }
    }

    func testCancelledTaskFailsBeforeConsumingInputs() async throws {
        let fixture = try Fixture()
        let task = Task.detached { () -> (CredentialFieldUpdateError?, Data, Data) in
            while !Task.isCancelled { await Task.yield() }
            var key = fixture.collectionKey
            var value = Data("cancel-value".utf8)
            do {
                _ = try fixture.update(key: &key, value: &value)
                return (nil, key, value)
            } catch {
                return (error as? CredentialFieldUpdateError, key, value)
            }
        }
        task.cancel()
        let (error, key, value) = await task.value
        XCTAssertEqual(error, .cancelled)
        XCTAssertEqual(key, fixture.collectionKey)
        XCTAssertEqual(value, Data("cancel-value".utf8))
    }

    private func assertThrows<T>(
        _ expected: CredentialFieldUpdateError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? CredentialFieldUpdateError, expected, file: file, line: line)
        }
    }
}

private struct Fixture: @unchecked Sendable {
    let vaultID = "vault-main"
    let collectionKey = Data(repeating: 0x31, count: 32)
    let vaultKey = Data(repeating: 0x71, count: 32)
    let selector = CredentialScalarFieldUpdateSelector(
        credentialID: "credential-target",
        fieldID: "field-password",
        key: "password"
    )
    let encryptedCollection: Data
    let records: [String: Data]
    let siblingRecordID: String

    init(
        duplicateLegacyKey: Bool = false,
        revealAllowed: Bool = true,
        secretType: String = "password",
        archived: Bool = false,
        recordStorageVersion: Int = 2,
        collectionRevision: Int = 7,
        vaultRevision: Int = 9
    ) throws {
        var records: [String: Data] = [:]
        var fields: [[String: Any]] = [
            ["id": "field-username", "key": "username", "value": "operator@example.test", "sensitive": false],
            ["id": "field-password", "key": "password", "value": "old-password", "sensitive": true],
            ["key": "legacy", "value": "legacy-value", "sensitive": true],
        ]
        if duplicateLegacyKey {
            fields.append(["key": "legacy", "value": "second-legacy", "sensitive": true])
        }
        if secretType == "image" {
            fields[1] = ["id": "field-password", "key": "__image__", "value": "", "sensitive": true]
        }
        var secret: [String: Any] = [
            "id": "credential-target", "name": "Production", "type": secretType,
            "fields": fields, "notes": "preserved notes",
            "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:01:00.000Z",
            "revealAllowed": revealAllowed,
            "opaqueSecret": ["marker": "kept", "count": 3],
        ]
        if secretType == "certificate" {
            secret["certificate"] = [
                "format": "PEM",
                "subject": "CN=Vaultage",
                "issuer": "CN=Vaultage CA",
                "serialNumber": "A1B2",
                "notBefore": "2026-08-25T12:00:00.000Z",
                "notAfter": "2027-08-25T12:00:00.000Z",
                "algorithm": "RSA",
                "sha256Fingerprint": String(repeating: "b", count: 64),
            ]
        }
        let sibling: [String: Any] = [
            "id": "credential-sibling", "name": "Sibling", "type": "password",
            "fields": [["id": "sibling-field", "key": "token", "value": "sibling-value", "sensitive": true]],
            "notes": "sibling notes", "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:01:00.000Z", "revealAllowed": true,
        ]
        let targetID = try Self.encodeRecord(kind: "secret", value: secret, key: vaultKey, records: &records)
        let siblingID = try Self.encodeRecord(kind: "secret", value: sibling, key: vaultKey, records: &records)
        siblingRecordID = siblingID
        let child: [String: Any] = [
            "metadata": ["id": "folder-child", "name": "Child", "opaque": "child-kept"],
            "children": [], "secrets": [targetID, siblingID],
        ]
        let childID = try Self.encodeRecord(kind: "folder", value: child, key: vaultKey, records: &records)
        let root: [String: Any] = [
            "metadata": ["id": vaultID, "name": "Root", "opaque": "root-kept"],
            "children": [childID], "secrets": [],
        ]
        let rootID = try Self.encodeRecord(kind: "folder", value: root, key: vaultKey, records: &records)
        self.records = records

        let wrapped = try Self.seal(
            vaultKey,
            key: collectionKey,
            nonce: Data(repeating: 0x22, count: 12),
            aad: Data("vaultage.vault-entry-key.aad.v1\0\(vaultID)".utf8)
        )
        let manifest: [String: Any] = [
            "format": "vaultage.record-store.v1", "storageVersion": recordStorageVersion,
            "vaultVersion": 2, "revision": vaultRevision, "root": rootID,
            "providers": [], "providerGroups": [], "providerGroupsPresent": true,
            "envProjects": [],
        ]
        let targetEntry: [String: Any] = [
            "id": vaultID, "name": "Main", "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:02:00.000Z", "archived": archived,
            "manifest": manifest,
            "wrappedKey": [
                "format": "vaultage.vault-key-envelope.v1", "algorithm": "aes-256-gcm",
                "wrappedKey": wrapped.base64EncodedString(),
            ],
        ]
        var collectionEntries = [targetEntry]
        var activeVaultID = vaultID
        if archived {
            activeVaultID = "vault-other"
            let otherWrapped = try Self.seal(
                vaultKey,
                key: collectionKey,
                nonce: Data(repeating: 0x23, count: 12),
                aad: Data("vaultage.vault-entry-key.aad.v1\0vault-other".utf8)
            )
            collectionEntries.append([
                "id": "vault-other", "name": "Other", "createdAt": "2026-08-25T12:00:00.000Z",
                "updatedAt": "2026-08-25T12:02:00.000Z", "archived": false,
                "manifest": manifest,
                "wrappedKey": [
                    "format": "vaultage.vault-key-envelope.v1", "algorithm": "aes-256-gcm",
                    "wrappedKey": otherWrapped.base64EncodedString(),
                ],
            ])
        }
        let collection: [String: Any] = [
            "format": "vaultage.vault-collection.v1", "storageVersion": 2,
            "revision": collectionRevision, "activeVaultId": activeVaultID,
            "vaults": collectionEntries,
        ]
        let canonical = try JSONSerialization.data(withJSONObject: collection, options: [.sortedKeys, .withoutEscapingSlashes])
        encryptedCollection = try Self.seal(canonical, key: collectionKey, nonce: Data(repeating: 0x11, count: 12))
    }

    var load: (String) throws -> Data {
        let values = records
        return { id in
            guard let value = values[id] else { throw CocoaError(.fileNoSuchFile) }
            return value
        }
    }

    func update(
        vaultID: String? = nil,
        selector: CredentialScalarFieldUpdateSelector? = nil,
        updatedAt: String = "2026-08-25T16:00:00.000Z",
        key: inout Data,
        value: inout Data,
        records suppliedRecords: [String: Data]? = nil
    ) throws -> CredentialScalarFieldUpdateResult {
        let blobs = suppliedRecords ?? records
        return try CredentialScalarFieldUpdater.updateCurrentV2CredentialScalarField(
            encryptedCollection: encryptedCollection,
            consumingCollectionKey: &key,
            vaultID: vaultID ?? self.vaultID,
            selector: selector ?? self.selector,
            consumingUTF8Value: &value,
            updatedAt: updatedAt,
            loadRecordBlob: { id in
                guard let blob = blobs[id] else { throw CocoaError(.fileNoSuchFile) }
                return blob
            }
        )
    }

    struct OpenedResult {
        let collectionRevision: Int
        let vaultRevision: Int
        let entryUpdatedAt: String
        let secret: [String: Any]
        let siblingRecordID: String
        let rootOpaque: String?
        let childOpaque: String?
        let allRecords: [String: Data]
    }

    func openResult(_ result: CredentialScalarFieldUpdateResult) throws -> OpenedResult {
        let collectionData = try Self.open(result.encryptedCollection, key: collectionKey)
        let collection = try JSONSerialization.jsonObject(with: collectionData) as! [String: Any]
        let entry = (collection["vaults"] as! [[String: Any]])[0]
        let manifest = entry["manifest"] as! [String: Any]
        var combined = records
        combined.merge(result.recordBlobs) { _, new in new }
        let root = try Self.openRecord(manifest["root"] as! String, key: vaultKey, records: combined)
        let rootValue = root["value"] as! [String: Any]
        let childID = (rootValue["children"] as! [String])[0]
        let child = try Self.openRecord(childID, key: vaultKey, records: combined)
        let childValue = child["value"] as! [String: Any]
        let secretIDs = childValue["secrets"] as! [String]
        let target = try Self.openRecord(secretIDs[0], key: vaultKey, records: combined)
        return OpenedResult(
            collectionRevision: (collection["revision"] as! NSNumber).intValue,
            vaultRevision: (manifest["revision"] as! NSNumber).intValue,
            entryUpdatedAt: entry["updatedAt"] as! String,
            secret: target["value"] as! [String: Any],
            siblingRecordID: secretIDs[1],
            rootOpaque: (rootValue["metadata"] as? [String: Any])?["opaque"] as? String,
            childOpaque: (childValue["metadata"] as? [String: Any])?["opaque"] as? String,
            allRecords: combined
        )
    }

    private static func encodeRecord(
        kind: String,
        value: Any,
        key: Data,
        records: inout [String: Data]
    ) throws -> String {
        let canonical = try JSONSerialization.data(
            withJSONObject: ["format": "vaultage.record.v1", "kind": kind, "value": value],
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        let indexKey = hmac(key: key, message: Data("vaultage-record-index-v2".utf8))
        let id = hmac(key: indexKey, message: canonical).map { String(format: "%02x", $0) }.joined()
        let paddedCount = ((12 + canonical.count + 255) / 256) * 256
        var padded = Data(repeating: 0, count: paddedCount)
        padded.replaceSubrange(0..<8, with: Data("VLTREC02".utf8))
        let length = UInt32(canonical.count)
        padded[8] = UInt8(truncatingIfNeeded: length >> 24)
        padded[9] = UInt8(truncatingIfNeeded: length >> 16)
        padded[10] = UInt8(truncatingIfNeeded: length >> 8)
        padded[11] = UInt8(truncatingIfNeeded: length)
        padded.replaceSubrange(12..<(12 + canonical.count), with: canonical)
        let encryptionKey = hmac(key: key, message: Data("vaultage-record-encryption-v1\0\(id)".utf8))
        records[id] = try seal(padded, key: encryptionKey, nonce: Data(repeating: UInt8(records.count + 0x40), count: 12))
        return id
    }

    private static func openRecord(
        _ id: String,
        key: Data,
        records: [String: Data]
    ) throws -> [String: Any] {
        let encryptionKey = hmac(key: key, message: Data("vaultage-record-encryption-v1\0\(id)".utf8))
        let padded = try open(records[id]!, key: encryptionKey)
        XCTAssertEqual(Data(padded.prefix(8)), Data("VLTREC02".utf8))
        let length = padded[8..<12].reduce(0) { ($0 << 8) | Int($1) }
        let canonical = Data(padded[12..<(12 + length)])
        let indexKey = hmac(key: key, message: Data("vaultage-record-index-v2".utf8))
        XCTAssertEqual(hmac(key: indexKey, message: canonical).map { String(format: "%02x", $0) }.joined(), id)
        return try JSONSerialization.jsonObject(with: canonical) as! [String: Any]
    }

    private static func hmac(key: Data, message: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: key)))
    }

    private static func seal(_ plaintext: Data, key: Data, nonce: Data, aad: Data = Data()) throws -> Data {
        let box = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: key),
            nonce: try AES.GCM.Nonce(data: nonce),
            authenticating: aad
        )
        var result = Data(box.nonce)
        result.append(box.tag)
        result.append(box.ciphertext)
        return result
    }

    private static func open(_ envelope: Data, key: Data, aad: Data = Data()) throws -> Data {
        let box = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: envelope.prefix(12)),
            ciphertext: envelope.dropFirst(28),
            tag: envelope.dropFirst(12).prefix(16)
        )
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
    }
}
