import CryptoKit
import Foundation

public enum TOTPAlgorithm: String, Equatable, Sendable {
    case sha1 = "SHA1"
    case sha256 = "SHA256"
    case sha512 = "SHA512"
}

public enum TOTPError: String, Error, Equatable, Sendable {
    case invalidUnixTime
    case invalidPeriod
    case invalidDigits
    case invalidSecret
    case invalidatedSecretLease
    case invalidatedCodeLease
    case cancelled
}

/// A short-lived TOTP value. Code bytes are only exposed to a synchronous
/// closure and are cleared by explicit invalidation or deinitialization. A
/// borrow that has already copied its scratch bytes may finish if concurrent or
/// reentrant invalidation wins; every subsequent borrow fails.
public final class TOTPCodeLease: @unchecked Sendable {
    public let validFrom: Int64
    public let validUntil: Int64

    private let lock = NSLock()
    private var codeBytes: Data
    private var isInvalidated = false

    init(codeBytes: Data, validFrom: Int64, validUntil: Int64) {
        self.codeBytes = codeBytes
        self.validFrom = validFrom
        self.validUntil = validUntil
    }

    public func withUTF8Code<Result>(_ use: (String) throws -> Result) throws -> Result {
        lock.lock()
        guard !isInvalidated else {
            lock.unlock()
            throw TOTPError.invalidatedCodeLease
        }
        var scratch = Data(codeBytes)
        lock.unlock()
        defer { scratch.resetBytes(in: scratch.startIndex..<scratch.endIndex) }
        guard let code = String(data: scratch, encoding: .utf8) else {
            throw TOTPError.invalidatedCodeLease
        }
        return try use(code)
    }

    @discardableResult
    public func invalidate() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !isInvalidated else { return true }
        codeBytes.resetBytes(in: codeBytes.startIndex..<codeBytes.endIndex)
        codeBytes.removeAll(keepingCapacity: false)
        isInvalidated = true
        return true
    }

    deinit {
        _ = invalidate()
    }
}

public enum TOTPGenerator {
    /// The one-second-to-five-minute range covers standard 30/60-second tokens while
    /// preventing a generated code from receiving an unexpectedly long life.
    public static let supportedPeriodSeconds = 1...300

    public static func generate(
        unixTime: Int64,
        period: Int,
        digits: Int,
        algorithm: TOTPAlgorithm,
        consumingSecret secret: inout Data
    ) throws -> TOTPCodeLease {
        guard unixTime >= 0 else { throw TOTPError.invalidUnixTime }
        guard supportedPeriodSeconds.contains(period) else { throw TOTPError.invalidPeriod }
        guard (6...8).contains(digits) else { throw TOTPError.invalidDigits }
        guard !Task.isCancelled else { throw TOTPError.cancelled }

        let period64 = Int64(period)
        let counter = unixTime / period64
        let validFrom = counter * period64
        let validUntilResult = validFrom.addingReportingOverflow(period64)
        guard !validUntilResult.overflow else { throw TOTPError.invalidUnixTime }

        let lease = try TOTPSecretLease(consuming: &secret)
        defer { lease.invalidate() }
        guard !Task.isCancelled else { throw TOTPError.cancelled }

        var bigEndianCounter = UInt64(counter).bigEndian
        var counterBytes = withUnsafeBytes(of: &bigEndianCounter) { Data($0) }
        defer { counterBytes.resetBytes(in: counterBytes.startIndex..<counterBytes.endIndex) }
        var authenticationCode = try lease.authenticationCode(
            counterBytes: counterBytes,
            algorithm: algorithm
        )
        defer {
            authenticationCode.resetBytes(
                in: authenticationCode.startIndex..<authenticationCode.endIndex
            )
        }
        guard !Task.isCancelled else { throw TOTPError.cancelled }

        let offset = Int(authenticationCode[authenticationCode.index(before: authenticationCode.endIndex)] & 0x0f)
        let binaryCode = (UInt32(authenticationCode[offset]) & 0x7f) << 24
            | UInt32(authenticationCode[offset + 1]) << 16
            | UInt32(authenticationCode[offset + 2]) << 8
            | UInt32(authenticationCode[offset + 3])
        let modulus = powerOfTen(digits)
        var remainingValue = binaryCode % modulus
        var codeBytes = Data(repeating: 48, count: digits)
        for index in stride(from: digits - 1, through: 0, by: -1) {
            codeBytes[index] = 48 + UInt8(remainingValue % 10)
            remainingValue /= 10
        }
        guard !Task.isCancelled else {
            codeBytes.resetBytes(in: codeBytes.startIndex..<codeBytes.endIndex)
            throw TOTPError.cancelled
        }
        return TOTPCodeLease(
            codeBytes: codeBytes,
            validFrom: validFrom,
            validUntil: validUntilResult.partialValue
        )
    }

    private static func powerOfTen(_ exponent: Int) -> UInt32 {
        var result: UInt32 = 1
        for _ in 0..<exponent { result *= 10 }
        return result
    }
}

final class TOTPSecretLease: @unchecked Sendable {
    private let lock = NSLock()
    private var secret: Data
    private var isInvalidated = false

    init(consuming input: inout Data) throws {
        var material = Data(input)
        input.resetBytes(in: input.startIndex..<input.endIndex)
        guard (10...128).contains(material.count) else {
            material.resetBytes(in: material.startIndex..<material.endIndex)
            throw TOTPError.invalidSecret
        }
        secret = material
    }

    func authenticationCode(counterBytes: Data, algorithm: TOTPAlgorithm) throws -> Data {
        lock.lock()
        defer {
            secret.resetBytes(in: secret.startIndex..<secret.endIndex)
            secret.removeAll(keepingCapacity: false)
            isInvalidated = true
            lock.unlock()
        }
        guard !isInvalidated else { throw TOTPError.invalidatedSecretLease }
        guard !Task.isCancelled else { throw TOTPError.cancelled }
        let key = SymmetricKey(data: secret)
        switch algorithm {
        case .sha1:
            return Data(HMAC<Insecure.SHA1>.authenticationCode(for: counterBytes, using: key))
        case .sha256:
            return Data(HMAC<SHA256>.authenticationCode(for: counterBytes, using: key))
        case .sha512:
            return Data(HMAC<SHA512>.authenticationCode(for: counterBytes, using: key))
        }
    }

    func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        guard !isInvalidated else { return }
        secret.resetBytes(in: secret.startIndex..<secret.endIndex)
        secret.removeAll(keepingCapacity: false)
        isInvalidated = true
    }

    deinit {
        invalidate()
    }
}
