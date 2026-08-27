import Foundation
import XCTest
@testable import VaultageCore

final class PasskeyRegistrationGeneratorTests: XCTestCase {
    func testUsesW3CES256VectorWithRequiredUserVerificationFlag() throws {
        var scalar = try XCTUnwrap(Data(hex: "6e68e7a58484a3264f66b77f5d6dc5bc36a47085b615c9727ab334e8c369c2ee"))
        let credentialID = try XCTUnwrap(Data(hex: "f91f391db4c9b2fde0ea70189cba3fb63f579ba6122b33ad94ff3ec330084be4"))
        let aaguid = try XCTUnwrap(Data(hex: "8446ccb9ab1db374750b2367ff6f3a1f"))
        // W3C Level 3 section 16.2 key/credential/AAGUID bytes, with the
        // fixture's randomized 0x59 flags replaced by this API's required
        // post-user-verification UP|UV|AT flags (0x45).
        let expected = try XCTUnwrap(Data(hex: "a363666d74646e6f6e656761747453746d74a068617574684461746158a4bfabc37432958b063360d3ad6461c9c4735ae7f8edd46592a5e0f01452b2e4b545000000008446ccb9ab1db374750b2367ff6f3a1f0020f91f391db4c9b2fde0ea70189cba3fb63f579ba6122b33ad94ff3ec330084be4a5010203262001215820afefa16f97ca9b2d23eb86ccb64098d20db90856062eb249c33a9b672f26df61225820930a56b87a2fca66334b03458abf879717c12cc68ed73290af2e2664796b9220"))

        let registration = try PasskeyRegistrationGenerator.makeDeterministicAfterUserPresenceAndVerification(
            relyingPartyID: "example.org",
            clientDataHash: Data(repeating: 0x5a, count: 32),
            supportedAlgorithms: [-7],
            credentialID: credentialID,
            aaguid: aaguid,
            consumingPrivateKey: &scalar
        ) { key, publicResult in
            XCTAssertEqual(key, try XCTUnwrap(Data(hex: "6e68e7a58484a3264f66b77f5d6dc5bc36a47085b615c9727ab334e8c369c2ee")))
            XCTAssertEqual(publicResult.credentialID, credentialID)
            key.resetBytes(in: key.startIndex..<key.endIndex)
        }

        XCTAssertEqual(scalar, Data(repeating: 0, count: 32))
        XCTAssertEqual(registration.algorithm, -7)
        XCTAssertEqual(registration.credentialID, credentialID)
        XCTAssertEqual(registration.attestationObject, expected)
    }

    func testGeneratedRegistrationIsFreshAndStorageConsumesScalar() throws {
        var observedKeys = [Data]()
        let first = try generate { key, _ in
            observedKeys.append(key)
            key.resetBytes(in: key.startIndex..<key.endIndex)
        }
        let second = try generate { key, _ in
            observedKeys.append(key)
            key.resetBytes(in: key.startIndex..<key.endIndex)
        }
        XCTAssertNotEqual(first.credentialID, second.credentialID)
        XCTAssertNotEqual(first.attestationObject, second.attestationObject)
        XCTAssertEqual(first.credentialID.count, 32)
        XCTAssertGreaterThan(first.attestationObject.count, 83)
        XCTAssertEqual(first.attestationObject.subdata(in: 67..<83), Data(repeating: 0, count: 16))
        XCTAssertEqual(observedKeys.count, 2)
        XCTAssertEqual(observedKeys[0].count, 32)
        XCTAssertNotEqual(observedKeys[0], observedKeys[1])
    }

    func testStorageMustConsumePrivateKey() throws {
        XCTAssertThrowsError(try generate { _, _ in }) {
            XCTAssertEqual($0 as? PasskeyRegistrationError, .privateKeyNotConsumed)
        }
    }

    func testStorageFailurePropagatesAfterClearing() throws {
        enum Expected: Error { case failure }
        XCTAssertThrowsError(try generate { key, _ in
            XCTAssertEqual(key.count, 32)
            throw Expected.failure
        }) {
            XCTAssertTrue($0 is Expected)
        }
    }

    func testPublicInputBoundsAndInvalidInputsNeverReachStorage() throws {
        let maximumRPID = [63, 63, 63, 61]
            .map { String(repeating: "a", count: $0) }
            .joined(separator: ".")
        XCTAssertEqual(maximumRPID.utf8.count, 253)
        let maximumAlgorithms = Array(repeating: -257, count: 63) + [-7]
        XCTAssertNoThrow(try PasskeyRegistrationGenerator.createAfterUserPresenceAndVerification(
            relyingPartyID: maximumRPID,
            clientDataHash: Data(repeating: 0, count: 32),
            supportedAlgorithms: maximumAlgorithms
        ) { key, _ in
            key.resetBytes(in: key.startIndex..<key.endIndex)
        })

        let cases: [(String, Data, [Int])] = [
            ("", Data(repeating: 0, count: 32), [-7]),
            ("Example.org", Data(repeating: 0, count: 32), [-7]),
            (maximumRPID + "a", Data(repeating: 0, count: 32), [-7]),
            ("example.org", Data(repeating: 0, count: 31), [-7]),
            ("example.org", Data(repeating: 0, count: 33), [-7]),
            ("example.org", Data(repeating: 0, count: 32), []),
            ("example.org", Data(repeating: 0, count: 32), [-257]),
            ("example.org", Data(repeating: 0, count: 32), Array(repeating: -7, count: 65)),
        ]
        for item in cases {
            var called = false
            XCTAssertThrowsError(try PasskeyRegistrationGenerator.createAfterUserPresenceAndVerification(
                relyingPartyID: item.0,
                clientDataHash: item.1,
                supportedAlgorithms: item.2
            ) { key, _ in
                called = true
                key.resetBytes(in: key.startIndex..<key.endIndex)
            })
            XCTAssertFalse(called)
        }
    }

    func testCancelledTaskDoesNotReachStorage() async throws {
        let task = Task.detached { () -> PasskeyRegistrationError? in
            withUnsafeCurrentTask { $0?.cancel() }
            do {
                _ = try PasskeyRegistrationGenerator.createAfterUserPresenceAndVerification(
                    relyingPartyID: "example.org",
                    clientDataHash: Data(repeating: 0, count: 32),
                    supportedAlgorithms: [-7]
                ) { key, _ in
                    key.resetBytes(in: key.startIndex..<key.endIndex)
                }
                return nil
            } catch {
                return error as? PasskeyRegistrationError
            }
        }
        let result = await task.value
        XCTAssertEqual(result, .cancelled)
    }

    private func generate(
        _ storage: (inout Data, PasskeyRegistration) throws -> Void
    ) throws -> PasskeyRegistration {
        try PasskeyRegistrationGenerator.createAfterUserPresenceAndVerification(
            relyingPartyID: "example.org",
            clientDataHash: Data(repeating: 0x33, count: 32),
            supportedAlgorithms: [-257, -7],
            storingPrivateKey: storage
        )
    }
}

private extension Data {
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2) else { return nil }
        var value = Data()
        value.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            value.append(byte)
            index = next
        }
        self = value
    }
}
