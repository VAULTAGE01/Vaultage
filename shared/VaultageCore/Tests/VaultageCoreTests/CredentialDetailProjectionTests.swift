import CryptoKit
import Foundation
import XCTest
@testable import VaultageCore

final class CredentialDetailProjectionTests: XCTestCase {
    private let collectionKey = Data(repeating: 0x42, count: 32)
    private let vaultKey = Data(repeating: 0x61, count: 32)
    private let vaultID = "vault-alpha"

    func testProjectsSemanticCredentialDetailWithoutValuesOrNotes() throws {
        let fixture = try detailFixture()
        let projection = try project(fixture, credentialID: "secret-production")

        XCTAssertEqual(projection.vaultID, vaultID)
        XCTAssertEqual(projection.vaultName, "Personal")
        XCTAssertEqual(projection.credential.id, "secret-production")
        XCTAssertEqual(projection.credential.name, "Production Password")
        XCTAssertEqual(projection.credential.type, "password")
        XCTAssertEqual(projection.credential.createdAt, "2026-08-25T12:00:00.000Z")
        XCTAssertEqual(projection.credential.updatedAt, "2026-08-25T12:01:00.000Z")
        XCTAssertEqual(projection.credential.folderPath, ["Personal"])
        XCTAssertEqual(projection.credential.scope, "production")
        XCTAssertEqual(projection.credential.tags, ["database", "production"])
        XCTAssertEqual(projection.credential.expiresAt, "2027-08-25T12:00:00.000Z")
        XCTAssertEqual(
            projection.credential.accessPolicy,
            CredentialAccessPolicy(browserExtension: false, agent: true, revealCopy: false, cliExport: false)
        )
        XCTAssertEqual(
            projection.credential.fields,
            [
                CredentialFieldDescriptor(id: "field-username", position: 0, key: "username", sensitive: false, hasValue: true),
                CredentialFieldDescriptor(id: "field-password", position: 1, key: "password", sensitive: true, hasValue: true),
                CredentialFieldDescriptor(id: nil, position: 2, key: "username", sensitive: false, hasValue: true),
            ]
        )

        let reflected = String(reflecting: projection)
        for sentinel in fixture.sentinels {
            XCTAssertFalse(reflected.contains(sentinel), "plaintext sentinel escaped the detail boundary")
        }
    }

    func testProjectsEmptyFieldAsHasValueFalseWithoutExposingIt() throws {
        let fixture = try detailFixture(fields: [
            field(id: nil, key: "optional", value: "", sensitive: false),
        ])
        let projection = try project(fixture, credentialID: "secret-production")
        XCTAssertEqual(
            projection.credential.fields,
            [CredentialFieldDescriptor(id: nil, position: 0, key: "optional", sensitive: false, hasValue: false)]
        )
    }

    func testRejectsMissingAndUnreachableSemanticCredentialID() throws {
        let reachable = try detailFixture()
        assertRejected { _ = try self.project(reachable, credentialID: "secret-does-not-exist") }

        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        _ = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-unreachable",
                fields: [field(id: nil, key: "password", value: "unreachable-value", sensitive: true)]
            ),
            storageVersion: 2
        )
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: []),
            storageVersion: 2
        )
        let unreachable = try fixture(builder: builder, rootID: rootID)
        assertRejected { _ = try self.project(unreachable, credentialID: "secret-unreachable") }
    }

    func testRejectsWrongKindForReachableCredentialReference() throws {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let wrongKindID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-wrong-kind", name: "Wrong", children: [], secrets: []),
            storageVersion: 2
        )
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [wrongKindID]),
            storageVersion: 2
        )
        let fixture = try fixture(builder: builder, rootID: rootID)
        assertRejected { _ = try self.project(fixture, credentialID: "secret-production") }
    }

    func testRejectsDuplicateReachableSemanticCredentialIDs() throws {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let first = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-production",
                fields: [field(id: "field-one", key: "password", value: "duplicate-one", sensitive: true)]
            ),
            storageVersion: 2
        )
        let second = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-production",
                fields: [field(id: "field-two", key: "password", value: "duplicate-two", sensitive: true)]
            ),
            storageVersion: 2
        )
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [first, second]),
            storageVersion: 2
        )
        let fixture = try fixture(builder: builder, rootID: rootID)
        assertRejected { _ = try self.project(fixture, credentialID: "secret-production") }
    }

    func testRejectsTamperedAndOversizeReachableRecordBlobs() throws {
        var tampered = try detailFixture()
        var blob = try XCTUnwrap(tampered.recordBlobs[tampered.rootRecordID])
        blob[blob.index(before: blob.endIndex)] ^= 0x01
        tampered.recordBlobs[tampered.rootRecordID] = blob
        assertRejected { _ = try self.project(tampered, credentialID: "secret-production") }

        var oversized = try detailFixture()
        oversized.recordBlobs[oversized.rootRecordID] = Data(
            repeating: 0,
            count: 10 * 1024 * 1024 + 64 * 1024 + 1
        )
        assertRejected { _ = try self.project(oversized, credentialID: "secret-production") }
    }

    func testRejectsCycleShapedFolderGraphBeforeReturningDetail() throws {
        // A valid content-addressed self-cycle would require a 256-bit fixed
        // point. This shaped adversarial record is consequently rejected at
        // content-ID verification before it could recurse indefinitely.
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let forgedID = String(repeating: "f", count: 64)
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [forgedID], secrets: []),
            storageVersion: 2,
            forcedID: forgedID
        )
        let fixture = try fixture(builder: builder, rootID: rootID)
        assertRejected { _ = try self.project(fixture, credentialID: "secret-production") }
    }

    func testRequiresProviderLinkToReachAuthenticatedProviderRecord() throws {
        func makeFixture(includeProvider: Bool, connectionTimestamp: String? = nil) throws -> Fixture {
            let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
            var provider: [String: Any] = [
                "id": "provider-production", "name": "Production Provider", "type": "custom",
                // Empty persisted config values are explicitly shipping-compatible.
                "config": ["endpoint": ""],
            ]
            if let connectionTimestamp {
                provider["connection"] = [
                    "schemaVersion": 1, "environment": "production", "authMethod": "api-token",
                    "custody": "encrypted-vault", "state": "active", "refreshState": "not-supported",
                    // Shipping normalization drops invalid optional identity labels.
                    "identity": ["account": NSNull()], "capabilities": ["read"],
                    "verifiedAt": connectionTimestamp,
                ]
            }
            let providerID = try builder.addRecord(
                kind: "provider",
                value: provider,
                storageVersion: 2
            )
            let secretID = try builder.addRecord(
                kind: "secret",
                value: secretValue(
                    id: "secret-production",
                    fields: [field(id: nil, key: "password", value: "provider-link-secret", sensitive: true)],
                    providerLink: [
                        "providerId": "provider-production", "remoteName": "remote-secret",
                        "createdInVaultage": true, "status": "active",
                    ]
                ),
                storageVersion: 2
            )
            let rootID = try builder.addRecord(
                kind: "folder",
                value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [secretID]),
                storageVersion: 2
            )
            return try fixture(builder: builder, rootID: rootID, providers: includeProvider ? [providerID] : [])
        }

        XCTAssertEqual(try project(makeFixture(includeProvider: true), credentialID: "secret-production").credential.id, "secret-production")
        XCTAssertEqual(
            try project(
                makeFixture(includeProvider: true, connectionTimestamp: "2026-08-25T12:00:00.000Z"),
                credentialID: "secret-production"
            ).credential.id,
            "secret-production"
        )
        assertRejected { _ = try self.project(try makeFixture(includeProvider: false), credentialID: "secret-production") }
        assertRejected {
            _ = try self.project(
                try makeFixture(includeProvider: true, connectionTimestamp: "2026-08-25T08:00:00.000-04:00"),
                credentialID: "secret-production"
            )
        }
    }

    func testValidatesPersistedImageRepresentationWithoutProjectingValue() throws {
        func makeFixture(imageValue: String) throws -> Fixture {
            let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
            let secretID = try builder.addRecord(
                kind: "secret",
                value: secretValue(
                    id: "secret-production",
                    type: "image",
                    fields: [field(id: "image-field", key: "__image__", value: imageValue, sensitive: true)]
                ),
                storageVersion: 2
            )
            let rootID = try builder.addRecord(
                kind: "folder",
                value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [secretID]),
                storageVersion: 2
            )
            return try fixture(builder: builder, rootID: rootID, sentinels: [imageValue])
        }

        let attachment = "vaultage-attachment:v1:\(String(repeating: "a", count: 64)):image/png"
        let projection = try project(makeFixture(imageValue: attachment), credentialID: "secret-production")
        XCTAssertFalse(String(reflecting: projection).contains(attachment))
        _ = try project(makeFixture(imageValue: "data:image/png;base64,AQID"), credentialID: "secret-production")
        assertRejected {
            _ = try self.project(try makeFixture(imageValue: "data:image/png;base64,A=== "), credentialID: "secret-production")
        }
    }

    func testValidatesCertificateMetadataWithoutProjectingIt() throws {
        func makeFixture(fingerprint: String) throws -> Fixture {
            let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
            let secretID = try builder.addRecord(
                kind: "secret",
                value: secretValue(
                    id: "secret-production",
                    type: "certificate",
                    fields: [field(id: nil, key: "certificate", value: "certificate-value-sentinel", sensitive: true)],
                    certificate: [
                        "format": "PEM", "subject": "CN=Vaultage", "issuer": "CN=Vaultage CA",
                        "serialNumber": "A1B2", "notBefore": "2026-08-25T12:00:00.000Z",
                        "notAfter": "2027-08-25T12:00:00.000Z", "algorithm": "RSA",
                        "sha256Fingerprint": fingerprint,
                    ]
                ),
                storageVersion: 2
            )
            let rootID = try builder.addRecord(
                kind: "folder",
                value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [secretID]),
                storageVersion: 2
            )
            return try fixture(builder: builder, rootID: rootID, sentinels: ["certificate-value-sentinel"])
        }

        let valid = String(repeating: "b", count: 64)
        let projection = try project(makeFixture(fingerprint: valid), credentialID: "secret-production")
        XCTAssertFalse(String(reflecting: projection).contains("certificate-value-sentinel"))
        assertRejected { _ = try self.project(try makeFixture(fingerprint: "NOT-A-FINGERPRINT"), credentialID: "secret-production") }
    }

    func testReleasesOneStableFieldIntoAnInvalidatableLease() throws {
        let fixture = try detailFixture(
            fields: [field(id: "field-password", key: "password", value: "release-unit-value", sensitive: true)],
            revealAllowed: true
        )
        let lease = try release(
            fixture,
            selector: CredentialFieldSelector(
                credentialID: "secret-production",
                fieldID: "field-password",
                position: 255,
                key: "password"
            )
        )
        XCTAssertEqual(lease.byteCount, Data("release-unit-value".utf8).count)
        XCTAssertEqual(try lease.withUTF8String { $0 }, "release-unit-value")
        XCTAssertTrue(lease.invalidate())
        XCTAssertEqual(lease.byteCount, 0)
        XCTAssertThrowsError(try lease.withUTF8String { $0 }) { error in
            XCTAssertEqual(error as? VaultageCoreError, .fieldLeaseInvalidated)
        }
    }

    func testLegacyReleaseRequiresExactPositionAndKey() throws {
        let fixture = try detailFixture(
            fields: [
                field(id: nil, key: "username", value: "legacy-first", sensitive: false),
                field(id: nil, key: "username", value: "legacy-second", sensitive: false),
            ],
            revealAllowed: true
        )
        let lease = try release(
            fixture,
            selector: CredentialFieldSelector(
                credentialID: "secret-production", fieldID: nil, position: 1, key: "username"
            )
        )
        XCTAssertEqual(try lease.withUTF8String { $0 }, "legacy-second")
        lease.invalidate()

        for selector in [
            CredentialFieldSelector(credentialID: "secret-production", fieldID: nil, position: 2, key: "username"),
            CredentialFieldSelector(credentialID: "secret-production", fieldID: nil, position: 1, key: "password"),
            CredentialFieldSelector(credentialID: "secret-production", fieldID: "missing-field", position: 0, key: "username"),
        ] {
            XCTAssertThrowsError(try release(fixture, selector: selector)) { error in
                XCTAssertEqual(error as? VaultageCoreError, .fieldNotFound)
            }
        }
    }

    func testReleaseEnforcesPolicyAndOneMegabyteBound() throws {
        let denied = try detailFixture(fields: [
            field(id: "field-password", key: "password", value: "denied-unit-value", sensitive: true),
        ])
        XCTAssertThrowsError(try release(
            denied,
            selector: CredentialFieldSelector(
                credentialID: "secret-production", fieldID: "field-password", position: 0, key: "password"
            )
        )) { error in
            XCTAssertEqual(error as? VaultageCoreError, .fieldReleaseDenied)
        }

        let oversized = try detailFixture(
            fields: [
                field(
                    id: "field-password",
                    key: "password",
                    value: String(repeating: "x", count: 1_000_001),
                    sensitive: true
                ),
            ],
            revealAllowed: true
        )
        XCTAssertThrowsError(try release(
            oversized,
            selector: CredentialFieldSelector(
                credentialID: "secret-production", fieldID: "field-password", position: 0, key: "password"
            )
        )) { error in
            XCTAssertEqual(error as? VaultageCoreError, .fieldValueTooLarge)
        }
    }

    private func project(_ fixture: Fixture, credentialID: String) throws -> CredentialDetailProjection {
        try VaultRecordProjectionReader.projectCredentialDetail(
            encryptedCollection: fixture.encryptedCollection,
            collectionKey: collectionKey,
            vaultID: vaultID,
            credentialID: credentialID,
            loadRecordBlob: { recordID in
                guard let blob = fixture.recordBlobs[recordID] else { throw FixtureError.missingRecord }
                return blob
            }
        )
    }

    private func release(
        _ fixture: Fixture,
        selector: CredentialFieldSelector
    ) throws -> CredentialFieldValueLease {
        try VaultRecordProjectionReader.releaseCredentialField(
            encryptedCollection: fixture.encryptedCollection,
            collectionKey: collectionKey,
            vaultID: vaultID,
            selector: selector,
            loadRecordBlob: { recordID in
                guard let blob = fixture.recordBlobs[recordID] else { throw FixtureError.missingRecord }
                return blob
            }
        )
    }

    private func detailFixture(
        fields: [[String: Any]]? = nil,
        revealAllowed: Bool = false
    ) throws -> Fixture {
        let builder = FixtureBuilder(collectionKey: collectionKey, vaultKey: vaultKey)
        let sentinels = [
            "detail-unit-username-sentinel",
            "detail-unit-password-sentinel",
            "detail-unit-duplicate-sentinel",
            "detail-unit-note-sentinel",
        ]
        let secretID = try builder.addRecord(
            kind: "secret",
            value: secretValue(
                id: "secret-production",
                fields: fields ?? [
                    field(id: "field-username", key: "username", value: sentinels[0], sensitive: false),
                    field(id: "field-password", key: "password", value: sentinels[1], sensitive: true),
                    field(id: nil, key: "username", value: sentinels[2], sensitive: false),
                ],
                notes: sentinels[3],
                revealAllowed: revealAllowed
            ),
            storageVersion: 2
        )
        let rootID = try builder.addRecord(
            kind: "folder",
            value: folderValue(id: "folder-root", name: "Personal", children: [], secrets: [secretID]),
            storageVersion: 2
        )
        return try fixture(builder: builder, rootID: rootID, sentinels: sentinels)
    }

    private func fixture(
        builder: FixtureBuilder,
        rootID: String,
        sentinels: [String] = [],
        providers: [String] = []
    ) throws -> Fixture {
        Fixture(
            encryptedCollection: try builder.collection(vaultID: vaultID, rootID: rootID, providers: providers),
            rootRecordID: rootID,
            recordBlobs: builder.recordBlobs,
            sentinels: sentinels
        )
    }

    private func secretValue(
        id: String,
        type: String = "password",
        fields: [[String: Any]],
        notes: String = "detail-unit-note-sentinel",
        providerLink: [String: Any]? = nil,
        certificate: [String: Any]? = nil,
        revealAllowed: Bool = false
    ) -> [String: Any] {
        var secret: [String: Any] = [
            "id": id,
            "name": "Production Password",
            "type": type,
            "description": "Database deployment credential",
            "scope": "production",
            "tags": ["database", "production"],
            "expiresAt": "2027-08-25T12:00:00.000Z",
            "agentAvailable": true,
            "browserExtensionAllowed": false,
            "revealAllowed": revealAllowed,
            "cliExportAllowed": false,
            "fields": fields,
            "notes": notes,
            "createdAt": "2026-08-25T12:00:00.000Z",
            "updatedAt": "2026-08-25T12:01:00.000Z",
        ]
        if let providerLink { secret["providerLink"] = providerLink }
        if let certificate { secret["certificate"] = certificate }
        return secret
    }

    private func folderValue(id: String, name: String, children: [String], secrets: [String]) -> [String: Any] {
        ["metadata": ["id": id, "name": name], "children": children, "secrets": secrets]
    }

    private func field(id: String?, key: String, value: String, sensitive: Bool) -> [String: Any] {
        var value: [String: Any] = ["key": key, "value": value, "sensitive": sensitive]
        if let id { value["id"] = id }
        return value
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
    let rootRecordID: String
    var recordBlobs: [String: Data]
    let sentinels: [String]
}

private enum FixtureError: Error {
    case missingRecord
}

private final class FixtureBuilder {
    private static let entryKeyDomain = Data("vaultage.vault-entry-key.aad.v1\0".utf8)
    private static let recordMagic = Data("VLTREC02".utf8)
    private let collectionKey: Data
    private let vaultKey: Data
    private var nonceByte: UInt8 = 0x50
    var recordBlobs: [String: Data] = [:]

    init(collectionKey: Data, vaultKey: Data) {
        self.collectionKey = collectionKey
        self.vaultKey = vaultKey
    }

    func collection(vaultID: String, rootID: String, providers: [String] = []) throws -> Data {
        let wrappedKey = try seal(
            vaultKey,
            key: collectionKey,
            aad: Self.entryKeyDomain + Data(vaultID.utf8)
        ).base64EncodedString()
        let collection: [String: Any] = [
            "format": "vaultage.vault-collection.v1", "storageVersion": 2,
            "revision": 7, "activeVaultId": vaultID,
            "vaults": [[
                "id": vaultID, "name": "Personal",
                "createdAt": "2026-08-25T12:00:00.000Z",
                "updatedAt": "2026-08-25T12:01:00.000Z", "archived": false,
                "manifest": [
                    "format": "vaultage.record-store.v1", "storageVersion": 2,
                    "vaultVersion": 2, "revision": 9, "root": rootID,
                    "providers": providers, "providerGroups": [], "providerGroupsPresent": true,
                    "envProjects": [],
                ],
                "wrappedKey": [
                    "format": "vaultage.vault-key-envelope.v1", "algorithm": "aes-256-gcm",
                    "wrappedKey": wrappedKey,
                ],
            ]],
        ]
        return try seal(canonicalJSON(collection), key: collectionKey)
    }

    func addRecord(
        kind: String,
        value: [String: Any],
        storageVersion: Int,
        forcedID: String? = nil
    ) throws -> String {
        let canonical = try canonicalJSON(["format": "vaultage.record.v1", "kind": kind, "value": value])
        let computedID = hex(hmac(
            purposeKey(vaultKey, "vaultage-record-index-v\(storageVersion)"), canonical
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
        let box = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: key),
            nonce: nonce,
            authenticating: aad ?? Data()
        )
        var envelope = Data(nonce)
        envelope.append(box.tag)
        envelope.append(box.ciphertext)
        return envelope
    }

    private func pad(_ canonical: Data) -> Data {
        let header = Self.recordMagic.count + MemoryLayout<UInt32>.size
        let size = ((header + canonical.count + 255) / 256) * 256
        var result = Data(repeating: 0, count: size)
        result.replaceSubrange(0..<Self.recordMagic.count, with: Self.recordMagic)
        var length = UInt32(canonical.count).bigEndian
        withUnsafeBytes(of: &length) { result.replaceSubrange(Self.recordMagic.count..<header, with: $0) }
        result.replaceSubrange(header..<(header + canonical.count), with: canonical)
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
