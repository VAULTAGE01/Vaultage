import Foundation
import XCTest
@testable import VaultageCore

final class TOTPProvisioningParserTests: XCTestCase {
    private let rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    func testParsesFullProvisioningAndGeneratesRFC6238Code() throws {
        var input = Data(
            "otpauth://totp/Example:alice%40example.com?secret=\(rfcSecret)&issuer=Example&algorithm=SHA1&digits=8&period=30".utf8
        )
        let originalCount = input.count
        let provisioning = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
        XCTAssertEqual(input, Data(repeating: 0, count: originalCount))
        XCTAssertEqual(
            provisioning.metadata,
            TOTPProvisioningMetadata(
                issuer: "Example",
                accountName: "alice@example.com",
                algorithm: .sha1,
                digits: 8,
                period: 30
            )
        )
        XCTAssertEqual(provisioning.secret.byteCount, 20)
        let code = try provisioning.secret.consume { secret in
            let lease = try TOTPGenerator.generate(
                unixTime: 59,
                period: provisioning.metadata.period,
                digits: provisioning.metadata.digits,
                algorithm: provisioning.metadata.algorithm,
                consumingSecret: &secret
            )
            defer { lease.invalidate() }
            return try lease.withUTF8Code { $0 }
        }
        XCTAssertEqual(code, "94287082")
        XCTAssertEqual(provisioning.secret.byteCount, 0)
        assertThrows(.invalidatedSecretLease) {
            try provisioning.secret.consume { $0.count }
        }
    }

    func testAppliesDefaultsAndAcceptsLowercaseCanonicalBase32() throws {
        var input = Data("otpauth://totp/account?secret=gezdgnbvgy3tqojqgezdgnbvgy3tqojq".utf8)
        let result = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
        XCTAssertEqual(result.metadata.issuer, nil)
        XCTAssertEqual(result.metadata.accountName, "account")
        XCTAssertEqual(result.metadata.algorithm, .sha1)
        XCTAssertEqual(result.metadata.digits, 6)
        XCTAssertEqual(result.metadata.period, 30)
        XCTAssertEqual(try consumeBytes(result.secret), Data("12345678901234567890".utf8))
    }

    func testAcceptsPercentEncodedIssuerSeparatorAndUnicodeLabels() throws {
        var input = Data(
            "otpauth://totp/Acme%20Corp%3Aalice%40example.com?secret=\(rfcSecret)&issuer=Acme%20Corp".utf8
        )
        let result = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
        XCTAssertEqual(result.metadata.issuer, "Acme Corp")
        XCTAssertEqual(result.metadata.accountName, "alice@example.com")
        result.secret.invalidate()

        input = Data("otpauth://totp/%E3%83%A6%E3%83%BC%E3%82%B6%E3%83%BC?secret=\(rfcSecret)".utf8)
        let unicode = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
        XCTAssertEqual(unicode.metadata.accountName, "ユーザー")
        unicode.secret.invalidate()

        input = Data("otpauth://totp/Example:alice@google.com?secret=\(rfcSecret)&issuer=Example".utf8)
        let rawAt = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
        XCTAssertEqual(rawAt.metadata.accountName, "alice@google.com")
        rawAt.secret.invalidate()
    }

    func testAcceptsEverySupportedAlgorithmDigitAndPeriodBoundary() throws {
        for algorithm in ["SHA1", "SHA256", "SHA512"] {
            for digits in [6, 8] {
                for period in [1, 30, 300] {
                    var input = Data(
                        "otpauth://totp/account?secret=\(rfcSecret)&algorithm=\(algorithm)&digits=\(digits)&period=\(period)".utf8
                    )
                    let result = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
                    XCTAssertEqual(result.metadata.algorithm.rawValue, algorithm)
                    XCTAssertEqual(result.metadata.digits, digits)
                    XCTAssertEqual(result.metadata.period, period)
                    result.secret.invalidate()
                }
            }
        }
    }

    func testRejectsWrongSchemeTypeFragmentsUserinfoPortsAndPathShape() throws {
        let cases: [(String, TOTPProvisioningError)] = [
            ("https://totp/account?secret=\(rfcSecret)", .invalidScheme),
            ("OTPAUTH://totp/account?secret=\(rfcSecret)", .invalidScheme),
            ("otpauth://hotp/account?secret=\(rfcSecret)&counter=1", .invalidType),
            ("otpauth://totp@example/account?secret=\(rfcSecret)", .invalidType),
            ("otpauth://totp:443/account?secret=\(rfcSecret)", .invalidType),
            ("otpauth://totp/a/b?secret=\(rfcSecret)", .invalidLabel),
            ("otpauth://totp/account?secret=\(rfcSecret)#fragment", .invalidInput),
        ]
        for (uri, expected) in cases {
            var input = Data(uri.utf8)
            assertThrows(expected) { try TOTPProvisioningParser.parse(consumingUTF8URI: &input) }
            XCTAssertTrue(input.allSatisfy { $0 == 0 })
        }
    }

    func testRejectsMissingDuplicateUnknownAndMalformedQueryParameters() throws {
        let cases: [(String, TOTPProvisioningError)] = [
            ("otpauth://totp/account?issuer=Example", .missingSecret),
            ("otpauth://totp/account?secret=\(rfcSecret)&secret=\(rfcSecret)", .duplicateParameter),
            ("otpauth://totp/account?secret=\(rfcSecret)&counter=1", .unknownParameter),
            ("otpauth://totp/account?secret", .invalidQuery),
            ("otpauth://totp/account?=value", .invalidQuery),
            ("otpauth://totp/account?secret=\(rfcSecret)&", .invalidQuery),
            ("otpauth://totp/account?secret=\(rfcSecret)=extra", .invalidSecret),
            ("otpauth://totp/account", .invalidQuery),
        ]
        for (uri, expected) in cases {
            var input = Data(uri.utf8)
            assertThrows(expected) { try TOTPProvisioningParser.parse(consumingUTF8URI: &input) }
            XCTAssertEqual(input, Data(repeating: 0, count: uri.utf8.count))
        }
    }

    func testRejectsMalformedPercentUTF8AndIssuerMismatch() throws {
        let cases: [(String, TOTPProvisioningError)] = [
            ("otpauth://totp/account%?secret=\(rfcSecret)", .invalidLabel),
            ("otpauth://totp/%GG?secret=\(rfcSecret)", .invalidLabel),
            ("otpauth://totp/%C3%28?secret=\(rfcSecret)", .invalidLabel),
            ("otpauth://totp/account?secret=\(rfcSecret)&issuer=%C3%28", .invalidLabel),
            ("otpauth://totp/Acme:alice?secret=\(rfcSecret)&issuer=Other", .issuerMismatch),
            ("otpauth://totp/:alice?secret=\(rfcSecret)", .invalidLabel),
            ("otpauth://totp/Acme:?secret=\(rfcSecret)", .invalidLabel),
            ("otpauth://totp/a:b:c?secret=\(rfcSecret)", .invalidLabel),
        ]
        for (uri, expected) in cases {
            var input = Data(uri.utf8)
            assertThrows(expected) { try TOTPProvisioningParser.parse(consumingUTF8URI: &input) }
            XCTAssertEqual(input, Data(repeating: 0, count: uri.utf8.count))
        }
    }

    func testBase32BoundsAlphabetPaddingWhitespaceAndTailBits() throws {
        for length in [10, 128] {
            let raw = Data((0..<length).map { UInt8(truncatingIfNeeded: $0 + 1) })
            var input = Data("otpauth://totp/account?secret=\(base32(raw))".utf8)
            let result = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
            XCTAssertEqual(try consumeBytes(result.secret), raw)
        }

        let below = base32(Data(repeating: 0x41, count: 9))
        let above = base32(Data(repeating: 0x41, count: 129))
        var noncanonicalTail = base32(Data(repeating: 0x41, count: 11))
        noncanonicalTail.replaceSubrange(noncanonicalTail.index(before: noncanonicalTail.endIndex)..., with: "B")
        for secret in [below, above, "MZXW6===", "MZX W6", "MZXW6!", noncanonicalTail] {
            let uri = "otpauth://totp/account?secret=\(secret)"
            var input = Data(uri.utf8)
            assertThrows(.invalidSecret) {
                try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
            }
            XCTAssertEqual(input, Data(repeating: 0, count: uri.utf8.count))
        }
    }

    func testRejectsAlgorithmDigitsPeriodAndLabelBoundsStrictly() throws {
        let cases: [(String, TOTPProvisioningError)] = [
            ("algorithm=sha1", .invalidAlgorithm),
            ("algorithm=MD5", .invalidAlgorithm),
            ("digits=5", .invalidDigits),
            ("digits=7", .invalidDigits),
            ("digits=09", .invalidDigits),
            ("digits=", .invalidDigits),
            ("period=0", .invalidPeriod),
            ("period=301", .invalidPeriod),
            ("period=030", .invalidPeriod),
        ]
        for (parameter, expected) in cases {
            let uri = "otpauth://totp/account?secret=\(rfcSecret)&\(parameter)"
            var input = Data(uri.utf8)
            assertThrows(expected) { try TOTPProvisioningParser.parse(consumingUTF8URI: &input) }
            XCTAssertEqual(input, Data(repeating: 0, count: uri.utf8.count))
        }

        for label in [" account", "account%0Aname", String(repeating: "a", count: 513)] {
            let uri = "otpauth://totp/\(label)?secret=\(rfcSecret)"
            var input = Data(uri.utf8)
            assertThrows(.invalidLabel) { try TOTPProvisioningParser.parse(consumingUTF8URI: &input) }
            XCTAssertEqual(input, Data(repeating: 0, count: uri.utf8.count))
        }
    }

    func testURIByteBoundAndInvalidUTF8AreRejectedAndConsumedAtCorrectBoundary() throws {
        var empty = Data()
        assertThrows(.invalidInput) { try TOTPProvisioningParser.parse(consumingUTF8URI: &empty) }
        XCTAssertTrue(empty.isEmpty)

        var oversized = Data(repeating: 0x61, count: TOTPProvisioningParser.maximumURIBytes + 1)
        let original = oversized
        assertThrows(.invalidInput) { try TOTPProvisioningParser.parse(consumingUTF8URI: &oversized) }
        XCTAssertEqual(oversized, original)

        var invalidUTF8 = Data("otpauth://totp/".utf8) + Data([0xff]) + Data("?secret=\(rfcSecret)".utf8)
        let count = invalidUTF8.count
        assertThrows(.invalidInput) { try TOTPProvisioningParser.parse(consumingUTF8URI: &invalidUTF8) }
        XCTAssertEqual(invalidUTF8, Data(repeating: 0, count: count))
    }

    func testCancellationAndExplicitLeaseInvalidationFailClosed() async throws {
        let task = Task.detached { () -> (TOTPProvisioningError?, Data) in
            while !Task.isCancelled { await Task.yield() }
            var input = Data("otpauth://totp/account?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".utf8)
            do {
                _ = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
                return (nil, input)
            } catch {
                return (error as? TOTPProvisioningError, input)
            }
        }
        task.cancel()
        let (error, returned) = await task.value
        XCTAssertEqual(error, .cancelled)
        XCTAssertEqual(returned, Data("otpauth://totp/account?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".utf8))

        var input = Data("otpauth://totp/account?secret=\(rfcSecret)".utf8)
        let parsed = try TOTPProvisioningParser.parse(consumingUTF8URI: &input)
        XCTAssertTrue(parsed.secret.invalidate())
        XCTAssertTrue(parsed.secret.invalidate())
        assertThrows(.invalidatedSecretLease) { try parsed.secret.consume { $0.count } }
    }

    private func consumeBytes(_ lease: TOTPProvisioningSecretLease) throws -> Data {
        try lease.consume { Data($0) }
    }

    private func base32(_ input: Data) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".utf8)
        var result = Data()
        var accumulator: UInt32 = 0
        var bits = 0
        for byte in input {
            accumulator = (accumulator << 8) | UInt32(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                result.append(alphabet[Int((accumulator >> UInt32(bits)) & 31)])
                accumulator &= bits == 0 ? 0 : (1 << UInt32(bits)) - 1
            }
        }
        if bits > 0 { result.append(alphabet[Int((accumulator << UInt32(5 - bits)) & 31)]) }
        return String(data: result, encoding: .ascii)!
    }

    private func assertThrows<T>(
        _ expected: TOTPProvisioningError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? TOTPProvisioningError, expected, file: file, line: line)
        }
    }
}
