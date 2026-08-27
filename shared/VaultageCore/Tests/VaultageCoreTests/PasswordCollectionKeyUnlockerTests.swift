import Foundation
import XCTest
@testable import VaultageCore

final class PasswordCollectionKeyUnlockerTests: XCTestCase {
    func testScryptMatchesRFC7914Vector() throws {
        let actual = try Scrypt.derive(
            password: Data(),
            salt: Data(),
            cost: 16,
            blockSize: 1,
            parallelization: 1,
            outputByteCount: 64
        )
        XCTAssertEqual(
            actual,
            data(hex: "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8d" +
                "fdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8" +
                "d3e0fb2e0d3628cf35e20c38d18906")
        )
    }

    func testScryptR8MatchesIndependentNodeVector() throws {
        let actual = try Scrypt.derive(
            password: Data("password".utf8),
            salt: Data("NaCl".utf8),
            cost: 1_024,
            blockSize: 8,
            parallelization: 1,
            outputByteCount: 64
        )
        XCTAssertEqual(
            actual,
            data(hex: "27b418c674c769d12501fbb1f53bac32df6514c0f28d043" +
                "872b148b348961a79057a6861cc3553246aa0ddb63bc07445" +
                "0b924022547a799538d603396835dd62")
        )
    }

    func testUnlocksIndependentNodeScryptAndAESGCMVectorToExactly32Bytes() throws {
        var password = Data("correct horse battery staple".utf8)
        let key = try PasswordCollectionKeyUnlocker.unlock(
            wrappedCollectionKey: data(hex:
                "0f0e0d0c0b0a0908070605048e819efd13241dca11d765ee" +
                "22f773643830954b5fd6c14b7d2125f3e30a35ae9bc94d29" +
                "f6e71d3ffd769d3e25ac4d41"
            ),
            parametersJSON: parametersJSON(),
            passwordUTF8: &password
        )
        XCTAssertEqual(key.count, 32)
        XCTAssertEqual(key, Data(0..<32))
    }

    func testWrongPasswordAndTamperedEnvelopeFailAuthentication() throws {
        let envelope = data(hex:
            "0f0e0d0c0b0a0908070605048e819efd13241dca11d765ee" +
            "22f773643830954b5fd6c14b7d2125f3e30a35ae9bc94d29" +
            "f6e71d3ffd769d3e25ac4d41"
        )
        var wrongPassword = Data("wrong password".utf8)
        assertThrows(.authenticationFailed) {
            try PasswordCollectionKeyUnlocker.unlock(
                wrappedCollectionKey: envelope,
                parametersJSON: parametersJSON(),
                passwordUTF8: &wrongPassword
            )
        }

        var tampered = envelope
        tampered[tampered.index(before: tampered.endIndex)] ^= 1
        var correctPassword = Data("correct horse battery staple".utf8)
        assertThrows(.authenticationFailed) {
            try PasswordCollectionKeyUnlocker.unlock(
                wrappedCollectionKey: tampered,
                parametersJSON: parametersJSON(),
                passwordUTF8: &correctPassword
            )
        }
    }

    func testRejectsEnvelopeLengthsBeforeDerivation() throws {
        for length in [0, 28, 59, 61] {
            var password = Data("unused".utf8)
            assertThrows(.invalidWrappedCollectionKey) {
                try PasswordCollectionKeyUnlocker.unlock(
                    wrappedCollectionKey: Data(repeating: 0, count: length),
                    parametersJSON: parametersJSON(),
                    passwordUTF8: &password
                )
            }
        }
    }

    func testParsesDefaultKeyLengthAndMaximumAllowedMemoryShape() throws {
        let parsed = try PasswordUnlockParameters.parse(json: parametersJSON(cost: 131_072, blockSize: 8))
        XCTAssertEqual(parsed.cost, 131_072)
        XCTAssertEqual(parsed.blockSize, 8)
        XCTAssertEqual(parsed.parallelization, 1)
        XCTAssertEqual(parsed.keyLength, 32)
        XCTAssertEqual(parsed.salt.count, 16)
    }

    func testRejectsEveryScryptNumericBoundAndTypeViolation() throws {
        let invalid: [[String: Any]] = [
            ["N": 1, "r": 1, "p": 1],
            ["N": 3, "r": 1, "p": 1],
            ["N": 262_144, "r": 1, "p": 1],
            ["N": 16, "r": 0, "p": 1],
            ["N": 16, "r": 9, "p": 1],
            ["N": 16, "r": 1, "p": 0],
            ["N": 16, "r": 1, "p": 2],
            ["N": 16, "r": 1, "p": 1, "keylen": 31],
            ["N": 16.5, "r": 1, "p": 1],
            ["N": true, "r": 1, "p": 1],
        ]
        for overrides in invalid {
            assertParseFails(scryptOverrides: overrides)
        }
    }

    func testRejectsEverySaltBoundAndEncodingViolation() throws {
        for salt in [
            String(repeating: "00", count: 15),
            String(repeating: "00", count: 129),
            "00112233445566778899aabbccddeef",
            "00112233445566778899aabbccddeefg",
        ] {
            assertParseFails(scryptOverrides: ["salt": salt])
        }
    }

    func testRejectsMalformedAndMissingParameterFields() throws {
        assertThrows(.invalidParameters) {
            try PasswordUnlockParameters.parse(json: Data())
        }
        assertThrows(.invalidParameters) {
            try PasswordUnlockParameters.parse(json: Data(repeating: 0x20, count: 65_537))
        }
        assertThrows(.invalidParameters) {
            try PasswordUnlockParameters.parse(json: Data("not-json".utf8))
        }
        assertThrows(.unsupportedVersion) {
            try PasswordUnlockParameters.parse(json: json(["version": 1, "scrypt": validScrypt()]))
        }
        assertThrows(.invalidParameters) {
            try PasswordUnlockParameters.parse(json: json(["version": 2]))
        }
        var missingSalt = validScrypt()
        missingSalt.removeValue(forKey: "salt")
        assertThrows(.invalidParameters) {
            try PasswordUnlockParameters.parse(json: json(["version": 2, "scrypt": missingSalt]))
        }
    }

    func testAcceptsShippingCompatibleUppercaseSaltAndUnknownFields() throws {
        var scrypt = validScrypt()
        scrypt["salt"] = "00112233445566778899AABBCCDDEEFF"
        scrypt["future"] = "ignored"
        let parsed = try PasswordUnlockParameters.parse(json: json([
            "version": 2,
            "scrypt": scrypt,
            "futureRoot": true,
        ]))
        XCTAssertEqual(parsed.salt, data(hex: "00112233445566778899aabbccddeeff"))
    }

    func testMidROMixCancellationStopsWithTypedFailure() async throws {
        let enteredROMix = DispatchSemaphore(value: 0)
        let allowCancellationCheck = DispatchSemaphore(value: 0)
        let task = Task.detached { () -> Result<Data, Error> in
            return Result {
                try Scrypt.derive(
                    password: Data("password".utf8),
                    salt: Data(repeating: 0x11, count: 16),
                    cost: 32_768,
                    blockSize: 1,
                    parallelization: 1,
                    outputByteCount: 32,
                    onROMixCheckpoint: {
                        enteredROMix.signal()
                        allowCancellationCheck.wait()
                    }
                )
            }
        }
        XCTAssertEqual(enteredROMix.wait(timeout: .now() + 5), .success)
        task.cancel()
        allowCancellationCheck.signal()
        switch await task.value {
        case .success:
            XCTFail("cancelled derivation unexpectedly completed")
        case .failure(let error):
            XCTAssertEqual(error as? PasswordUnlockError, .cancelled)
        }
    }

    private func assertParseFails(
        scryptOverrides: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        var value = validScrypt()
        for (key, replacement) in scryptOverrides { value[key] = replacement }
        assertThrows(.invalidParameters, file: file, line: line) {
            try PasswordUnlockParameters.parse(json: json(["version": 2, "scrypt": value]))
        }
    }

    private func assertThrows<T>(
        _ expected: PasswordUnlockError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? PasswordUnlockError, expected, file: file, line: line)
        }
    }

    private func parametersJSON(cost: Int = 16, blockSize: Int = 1) -> Data {
        json(["version": 2, "scrypt": validScrypt(cost: cost, blockSize: blockSize)])
    }

    private func validScrypt(cost: Int = 16, blockSize: Int = 1) -> [String: Any] {
        [
            "N": cost,
            "r": blockSize,
            "p": 1,
            "salt": "00112233445566778899aabbccddeeff",
        ]
    }

    private func json(_ object: Any) -> Data {
        try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
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
