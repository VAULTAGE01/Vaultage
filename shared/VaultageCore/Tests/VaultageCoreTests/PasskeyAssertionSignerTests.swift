import CryptoKit
import Foundation
import XCTest
@testable import VaultageCore

final class PasskeyAssertionSignerTests: XCTestCase {
    private let clientDataHash = Data(0..<32)
    private let credentialID = Data([0xde, 0xad, 0xbe, 0xef])
    private let userHandle = Data("user-123".utf8)

    func testBuildsOfficialAuthenticatorDataShapeAndVerifiableDERSignature() throws {
        let verificationKey = try P256.Signing.PrivateKey(rawRepresentation: scalarOne()).publicKey
        var privateKey = scalarOne()
        let assertion = try sign(privateKey: &privateKey)

        XCTAssertEqual(privateKey, Data(repeating: 0, count: 32))
        XCTAssertEqual(assertion.credentialID, credentialID)
        XCTAssertEqual(assertion.userHandle, userHandle)
        XCTAssertEqual(assertion.authenticatorData.count, 37)
        XCTAssertEqual(
            assertion.authenticatorData,
            data(hex: "a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab" +
                "13d2125586ce19470500000000")
        )

        let signature = try P256.Signing.ECDSASignature(derRepresentation: assertion.signatureDER)
        var signedBytes = assertion.authenticatorData
        signedBytes.append(clientDataHash)
        XCTAssertTrue(verificationKey.isValidSignature(signature, for: signedBytes))
    }

    func testSignatureRejectsAuthenticatorAndClientHashTampering() throws {
        let verificationKey = try P256.Signing.PrivateKey(rawRepresentation: scalarOne()).publicKey
        var privateKey = scalarOne()
        let assertion = try sign(privateKey: &privateKey)
        let signature = try P256.Signing.ECDSASignature(derRepresentation: assertion.signatureDER)

        var tamperedAuthenticator = assertion.authenticatorData
        tamperedAuthenticator[0] ^= 1
        tamperedAuthenticator.append(clientDataHash)
        XCTAssertFalse(verificationKey.isValidSignature(signature, for: tamperedAuthenticator))

        var tamperedHash = clientDataHash
        tamperedHash[0] ^= 1
        var tamperedClientMessage = assertion.authenticatorData
        tamperedClientMessage.append(tamperedHash)
        XCTAssertFalse(verificationKey.isValidSignature(signature, for: tamperedClientMessage))
    }

    func testAcceptsCanonicalLocalhostAndPunycodeRelyingPartyIDs() throws {
        let maximumRPID = [
            String(repeating: "a", count: 63),
            String(repeating: "b", count: 63),
            String(repeating: "c", count: 63),
            String(repeating: "d", count: 61),
        ].joined(separator: ".")
        XCTAssertEqual(maximumRPID.utf8.count, 253)
        for relyingPartyID in ["localhost", "login.example.com", "xn--bcher-kva.example", maximumRPID] {
            var privateKey = scalarOne()
            XCTAssertNoThrow(try sign(relyingPartyID: relyingPartyID, privateKey: &privateKey))
        }
    }

    func testRejectsNoncanonicalOrOutOfBoundsRelyingPartyIDsBeforeConsumingKey() throws {
        let invalid = [
            "", ".example.com", "example.com.", "Example.com", "example..com",
            "-example.com", "example-.com", "https://example.com", "example.com:443",
            "example/com", "127.0.0.1", "bücher.example",
            String(repeating: "a", count: 64) + ".com",
            String(repeating: "a", count: 250) + ".com",
        ]
        for relyingPartyID in invalid {
            var privateKey = scalarOne()
            assertThrows(.invalidRelyingPartyID) {
                try sign(relyingPartyID: relyingPartyID, privateKey: &privateKey)
            }
            XCTAssertEqual(privateKey, scalarOne())
        }
    }

    func testRejectsClientHashCredentialAndUserHandleBoundsBeforeConsumingKey() throws {
        for hashLength in [0, 31, 33] {
            var key = scalarOne()
            assertThrows(.invalidClientDataHash) {
                try sign(clientDataHash: Data(repeating: 0, count: hashLength), privateKey: &key)
            }
            XCTAssertEqual(key, scalarOne())
        }
        for credentialLength in [0, 1_024] {
            var key = scalarOne()
            assertThrows(.invalidCredentialID) {
                try sign(credentialID: Data(repeating: 0, count: credentialLength), privateKey: &key)
            }
            XCTAssertEqual(key, scalarOne())
        }
        for handleLength in [0, 65] {
            var key = scalarOne()
            assertThrows(.invalidUserHandle) {
                try sign(userHandle: Data(repeating: 0, count: handleLength), privateKey: &key)
            }
            XCTAssertEqual(key, scalarOne())
        }
    }

    func testAllowsMaximumBoundedPublicByteInputs() throws {
        var key = scalarOne()
        let maximumHandle = Data(repeating: 0x6b, count: 64)
        let assertion = try sign(
            credentialID: Data(repeating: 0x5a, count: 1_023),
            userHandle: maximumHandle,
            privateKey: &key
        )
        XCTAssertEqual(assertion.credentialID.count, 1_023)
        XCTAssertEqual(assertion.userHandle, maximumHandle)
    }

    func testRejectsNonES256AlgorithmBeforeConsumingKey() throws {
        for algorithm in [-8, 0, 7] {
            var key = scalarOne()
            assertThrows(.unsupportedAlgorithm) {
                try sign(algorithm: algorithm, privateKey: &key)
            }
            XCTAssertEqual(key, scalarOne())
        }
    }

    func testRejectsInvalidPrivateKeyAndClearsConsumedBuffer() throws {
        for material in [Data(), Data(repeating: 1, count: 31), Data(repeating: 0, count: 32), Data(repeating: 1, count: 33)] {
            var key = material
            assertThrows(.invalidPrivateKey) { try sign(privateKey: &key) }
            XCTAssertEqual(key, Data(repeating: 0, count: material.count))
        }
    }

    func testInvalidatedLeaseCannotSign() throws {
        var key = scalarOne()
        let lease = try PasskeyPrivateKeyLease(consuming: &key)
        lease.invalidate()
        assertThrows(.invalidatedKeyLease) {
            try lease.signDER(message: Data(repeating: 0, count: 69))
        }
    }

    func testLeaseInvalidatesAfterOneSuccessfulSignature() throws {
        var key = scalarOne()
        let lease = try PasskeyPrivateKeyLease(consuming: &key)
        _ = try lease.signDER(message: Data(repeating: 0, count: 69))
        assertThrows(.invalidatedKeyLease) {
            try lease.signDER(message: Data(repeating: 0, count: 69))
        }
    }

    func testCancelledTaskFailsClosedBeforeConsumingKey() async throws {
        let task = Task.detached { () -> (PasskeyAssertionError?, Data) in
            while !Task.isCancelled { await Task.yield() }
            var key = Data(repeating: 0, count: 31) + Data([1])
            do {
                _ = try PasskeyAssertionSigner.signAfterUserPresenceAndVerification(
                    relyingPartyID: "example.com",
                    clientDataHash: Data(0..<32),
                    credentialID: Data([0xde, 0xad, 0xbe, 0xef]),
                    userHandle: Data("user-123".utf8),
                    algorithm: PasskeyAssertionSigner.es256Algorithm,
                    consumingPrivateKey: &key
                )
                return (nil, key)
            } catch {
                return (error as? PasskeyAssertionError, key)
            }
        }
        task.cancel()
        let (error, key) = await task.value
        XCTAssertEqual(error, .cancelled)
        XCTAssertEqual(key, scalarOne())
    }

    private func sign(
        relyingPartyID: String = "example.com",
        clientDataHash: Data? = nil,
        credentialID: Data? = nil,
        userHandle: Data? = nil,
        algorithm: Int = PasskeyAssertionSigner.es256Algorithm,
        privateKey: inout Data
    ) throws -> PasskeyAssertion {
        try PasskeyAssertionSigner.signAfterUserPresenceAndVerification(
            relyingPartyID: relyingPartyID,
            clientDataHash: clientDataHash ?? self.clientDataHash,
            credentialID: credentialID ?? self.credentialID,
            userHandle: userHandle ?? self.userHandle,
            algorithm: algorithm,
            consumingPrivateKey: &privateKey
        )
    }

    private func assertThrows<T>(
        _ expected: PasskeyAssertionError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? PasskeyAssertionError, expected, file: file, line: line)
        }
    }

    private func scalarOne() -> Data {
        Data(repeating: 0, count: 31) + Data([1])
    }

    private func data(hex: String) -> Data {
        var result = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            result.append(UInt8(hex[index..<next], radix: 16)!)
            index = next
        }
        return result
    }
}
