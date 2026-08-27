import Foundation
import XCTest
@testable import VaultageCore

final class TOTPGeneratorTests: XCTestCase {
    func testAllRFC6238AppendixBVectors() throws {
        let times: [Int64] = [59, 1_111_111_109, 1_111_111_111, 1_234_567_890, 2_000_000_000, 20_000_000_000]
        let vectors: [(TOTPAlgorithm, Data, [String])] = [
            (.sha1, Data("12345678901234567890".utf8), [
                "94287082", "07081804", "14050471", "89005924", "69279037", "65353130",
            ]),
            (.sha256, Data("12345678901234567890123456789012".utf8), [
                "46119246", "68084774", "67062674", "91819424", "90698825", "77737706",
            ]),
            (.sha512, Data("1234567890123456789012345678901234567890123456789012345678901234".utf8), [
                "90693936", "25091201", "99943326", "93441116", "38618901", "47863826",
            ]),
        ]

        for (algorithm, secretTemplate, expectedCodes) in vectors {
            for (index, unixTime) in times.enumerated() {
                var secret = secretTemplate
                let lease = try TOTPGenerator.generate(
                    unixTime: unixTime,
                    period: 30,
                    digits: 8,
                    algorithm: algorithm,
                    consumingSecret: &secret
                )
                XCTAssertEqual(try code(from: lease), expectedCodes[index])
                XCTAssertEqual(secret, Data(repeating: 0, count: secretTemplate.count))
                XCTAssertEqual(lease.validFrom, (unixTime / 30) * 30)
                XCTAssertEqual(lease.validUntil, (unixTime / 30) * 30 + 30)
                lease.invalidate()
            }
        }
    }

    func testRFC4226DynamicTruncationVectors() throws {
        let expected = [
            "755224", "287082", "359152", "969429", "338314",
            "254676", "287922", "162583", "399871", "520489",
        ]
        for counter in 0..<10 {
            var secret = Data("12345678901234567890".utf8)
            let lease = try TOTPGenerator.generate(
                unixTime: Int64(counter),
                period: 1,
                digits: 6,
                algorithm: .sha1,
                consumingSecret: &secret
            )
            XCTAssertEqual(try code(from: lease), expected[counter])
            lease.invalidate()
        }
    }

    func testSupportsPost2038TimeAndExactWindowMetadata() throws {
        var secret = Data("12345678901234567890".utf8)
        let lease = try TOTPGenerator.generate(
            unixTime: 20_000_000_000,
            period: 30,
            digits: 8,
            algorithm: .sha1,
            consumingSecret: &secret
        )
        XCTAssertEqual(try code(from: lease), "65353130")
        XCTAssertEqual(lease.validFrom, 19_999_999_980)
        XCTAssertEqual(lease.validUntil, 20_000_000_010)
    }

    func testRejectsTimePeriodAndDigitBoundsBeforeConsumingSecret() throws {
        for unixTime in [Int64(-1), Int64.max] {
            var secret = validSecret()
            assertThrows(.invalidUnixTime) {
                try generate(unixTime: unixTime, secret: &secret)
            }
            XCTAssertEqual(secret, validSecret())
        }
        for period in [0, 301] {
            var secret = validSecret()
            assertThrows(.invalidPeriod) { try generate(period: period, secret: &secret) }
            XCTAssertEqual(secret, validSecret())
        }
        for digits in [5, 9] {
            var secret = validSecret()
            assertThrows(.invalidDigits) { try generate(digits: digits, secret: &secret) }
            XCTAssertEqual(secret, validSecret())
        }
    }

    func testAcceptsExactSecretPeriodAndDigitBoundsAcrossAlgorithms() throws {
        for secretLength in [10, 128] {
            for period in [1, 30, 300] {
                for digits in [6, 7, 8] {
                    for algorithm in [TOTPAlgorithm.sha1, .sha256, .sha512] {
                        var secret = Data(repeating: 0x5a, count: secretLength)
                        let lease = try generate(
                            period: period,
                            digits: digits,
                            algorithm: algorithm,
                            secret: &secret
                        )
                        XCTAssertEqual(try code(from: lease).count, digits)
                        XCTAssertEqual(secret, Data(repeating: 0, count: secretLength))
                        lease.invalidate()
                    }
                }
            }
        }
    }

    func testRejectsInvalidSecretBoundsAndClearsConsumedInput() throws {
        for secretLength in [0, 9, 129] {
            var secret = Data(repeating: 0x5a, count: secretLength)
            assertThrows(.invalidSecret) { try generate(secret: &secret) }
            XCTAssertEqual(secret, Data(repeating: 0, count: secretLength))
        }
    }

    func testCodeLeaseIsClosureOnlyAndFailsAfterInvalidation() throws {
        var secret = validSecret()
        let lease = try generate(secret: &secret)
        XCTAssertEqual(try code(from: lease).count, 6)
        XCTAssertTrue(lease.invalidate())
        XCTAssertTrue(lease.invalidate())
        assertThrows(.invalidatedCodeLease) {
            try lease.withUTF8Code { $0 }
        }
    }

    func testCodeBorrowCanReentrantlyInvalidateWithoutDeadlock() throws {
        var secret = validSecret()
        let lease = try generate(secret: &secret)
        let observed = try lease.withUTF8Code { code in
            XCTAssertTrue(lease.invalidate())
            return code
        }
        XCTAssertEqual(observed, "287082")
        assertThrows(.invalidatedCodeLease) {
            try lease.withUTF8Code { $0 }
        }
    }

    func testSecretLeaseIsOneShotAndExplicitlyInvalidatable() throws {
        var secret = validSecret()
        let used = try TOTPSecretLease(consuming: &secret)
        _ = try used.authenticationCode(counterBytes: Data(repeating: 0, count: 8), algorithm: .sha1)
        assertThrows(.invalidatedSecretLease) {
            try used.authenticationCode(counterBytes: Data(repeating: 0, count: 8), algorithm: .sha1)
        }

        secret = validSecret()
        let invalidated = try TOTPSecretLease(consuming: &secret)
        invalidated.invalidate()
        assertThrows(.invalidatedSecretLease) {
            try invalidated.authenticationCode(counterBytes: Data(repeating: 0, count: 8), algorithm: .sha1)
        }
    }

    func testCancelledTaskFailsClosedBeforeConsumingSecret() async throws {
        let task = Task.detached { () -> (TOTPError?, Data) in
            while !Task.isCancelled { await Task.yield() }
            var secret = Data("12345678901234567890".utf8)
            do {
                _ = try TOTPGenerator.generate(
                    unixTime: 59,
                    period: 30,
                    digits: 6,
                    algorithm: .sha1,
                    consumingSecret: &secret
                )
                return (nil, secret)
            } catch {
                return (error as? TOTPError, secret)
            }
        }
        task.cancel()
        let (error, secret) = await task.value
        XCTAssertEqual(error, .cancelled)
        XCTAssertEqual(secret, validSecret())
    }

    private func generate(
        unixTime: Int64 = 59,
        period: Int = 30,
        digits: Int = 6,
        algorithm: TOTPAlgorithm = .sha1,
        secret: inout Data
    ) throws -> TOTPCodeLease {
        try TOTPGenerator.generate(
            unixTime: unixTime,
            period: period,
            digits: digits,
            algorithm: algorithm,
            consumingSecret: &secret
        )
    }

    private func code(from lease: TOTPCodeLease) throws -> String {
        try lease.withUTF8Code { $0 }
    }

    private func validSecret() -> Data {
        Data("12345678901234567890".utf8)
    }

    private func assertThrows<T>(
        _ expected: TOTPError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ operation: () throws -> T
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            XCTAssertEqual(error as? TOTPError, expected, file: file, line: line)
        }
    }
}
