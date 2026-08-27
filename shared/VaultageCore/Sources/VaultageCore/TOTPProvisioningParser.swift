import Foundation

public enum TOTPProvisioningError: String, Error, Equatable, Sendable {
    case invalidInput
    case invalidScheme
    case invalidType
    case invalidLabel
    case invalidQuery
    case duplicateParameter
    case unknownParameter
    case missingSecret
    case invalidSecret
    case issuerMismatch
    case invalidAlgorithm
    case invalidDigits
    case invalidPeriod
    case invalidatedSecretLease
    case cancelled
}

public struct TOTPProvisioningMetadata: Equatable, Sendable {
    public let issuer: String?
    public let accountName: String
    public let algorithm: TOTPAlgorithm
    public let digits: Int
    public let period: Int
}

public struct TOTPProvisioning: Sendable {
    public let metadata: TOTPProvisioningMetadata
    public let secret: TOTPProvisioningSecretLease
}

/// One-shot decoded seed custody. The retained bytes are invalidated before
/// the caller closure begins; a mutable scratch is cleared when it returns.
public final class TOTPProvisioningSecretLease: @unchecked Sendable {
    private let lock = NSLock()
    private var bytes: Data
    private var invalidated = false

    init(bytes: Data) {
        self.bytes = bytes
    }

    public var byteCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return invalidated ? 0 : bytes.count
    }

    public func consume<Result>(_ use: (inout Data) throws -> Result) throws -> Result {
        lock.lock()
        guard !invalidated else {
            lock.unlock()
            throw TOTPProvisioningError.invalidatedSecretLease
        }
        var scratch = Data(bytes)
        bytes.resetBytes(in: bytes.startIndex..<bytes.endIndex)
        bytes.removeAll(keepingCapacity: false)
        invalidated = true
        lock.unlock()
        defer { scratch.resetBytes(in: scratch.startIndex..<scratch.endIndex) }
        guard !Task.isCancelled else { throw TOTPProvisioningError.cancelled }
        return try use(&scratch)
    }

    @discardableResult
    public func invalidate() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !invalidated else { return true }
        bytes.resetBytes(in: bytes.startIndex..<bytes.endIndex)
        bytes.removeAll(keepingCapacity: false)
        invalidated = true
        return true
    }

    deinit {
        _ = invalidate()
    }
}

public enum TOTPProvisioningParser {
    public static let maximumURIBytes = 8_192
    private static let maximumLabelCharacters = 512
    private static let allowedParameters: Set<String> = [
        "secret", "issuer", "algorithm", "digits", "period",
    ]
    private static let prefix = Data("otpauth://totp/".utf8)

    public static func parse(consumingUTF8URI input: inout Data) throws -> TOTPProvisioning {
        guard !Task.isCancelled else { throw TOTPProvisioningError.cancelled }
        guard !input.isEmpty, input.count <= maximumURIBytes else {
            throw TOTPProvisioningError.invalidInput
        }

        var uri = Data(input)
        input.resetBytes(in: input.startIndex..<input.endIndex)
        defer { uri.resetBytes(in: uri.startIndex..<uri.endIndex) }
        guard uri.allSatisfy({ $0 < 128 }) else { throw TOTPProvisioningError.invalidInput }
        guard !uri.contains(0x23) else { throw TOTPProvisioningError.invalidInput } // fragment

        guard uri.starts(with: Data("otpauth://".utf8)) else {
            throw TOTPProvisioningError.invalidScheme
        }
        guard uri.starts(with: prefix) else {
            throw TOTPProvisioningError.invalidType
        }
        guard let queryMark = uri.firstIndex(of: 0x3f) else {
            throw TOTPProvisioningError.invalidQuery
        }
        guard uri[uri.index(after: queryMark)...].firstIndex(of: 0x3f) == nil else {
            throw TOTPProvisioningError.invalidQuery
        }
        let labelStart = uri.startIndex + prefix.count
        guard labelStart < queryMark else { throw TOTPProvisioningError.invalidLabel }
        let rawLabel = Data(uri[labelStart..<queryMark])
        guard !rawLabel.contains(0x2f) else {
            throw TOTPProvisioningError.invalidLabel
        }
        let label = try decodedText(rawLabel, error: .invalidLabel)
        let labelParts = label.split(separator: ":", omittingEmptySubsequences: false)
        guard labelParts.count <= 2 else { throw TOTPProvisioningError.invalidLabel }
        let labelIssuer: String?
        let account: String
        if labelParts.count == 2 {
            labelIssuer = try boundedLabel(String(labelParts[0]))
            account = try boundedLabel(String(labelParts[1]))
        } else {
            labelIssuer = nil
            account = try boundedLabel(label)
        }

        let queryStart = uri.index(after: queryMark)
        guard queryStart < uri.endIndex else { throw TOTPProvisioningError.invalidQuery }
        let rawParameters = Data(uri[queryStart..<uri.endIndex]).split(
            separator: 0x26,
            omittingEmptySubsequences: false
        )
        guard !rawParameters.isEmpty, rawParameters.count <= allowedParameters.count,
              !rawParameters.contains(where: { $0.isEmpty }) else {
            throw TOTPProvisioningError.invalidQuery
        }

        var seen = Set<String>()
        var secretText: Data?
        var issuer: String?
        var algorithm = TOTPAlgorithm.sha1
        var digits = 6
        var period = 30
        defer { clearOptionalData(&secretText) }

        for rawParameter in rawParameters {
            guard !Task.isCancelled else { throw TOTPProvisioningError.cancelled }
            guard let separator = rawParameter.firstIndex(of: 0x3d),
                  separator != rawParameter.startIndex else {
                throw TOTPProvisioningError.invalidQuery
            }
            let name = try decodedText(Data(rawParameter[..<separator]), error: .invalidQuery)
            guard allowedParameters.contains(name) else {
                throw TOTPProvisioningError.unknownParameter
            }
            guard seen.insert(name).inserted else {
                throw TOTPProvisioningError.duplicateParameter
            }
            let valueStart = rawParameter.index(after: separator)
            var decoded = try percentDecode(Data(rawParameter[valueStart...]), error: .invalidQuery)
            defer { decoded.resetBytes(in: decoded.startIndex..<decoded.endIndex) }
            switch name {
            case "secret":
                guard !decoded.isEmpty else { throw TOTPProvisioningError.invalidSecret }
                secretText = Data(decoded)
            case "issuer":
                issuer = try boundedLabelText(decoded)
            case "algorithm":
                guard let raw = String(data: decoded, encoding: .utf8),
                      let parsed = TOTPAlgorithm(rawValue: raw) else {
                    throw TOTPProvisioningError.invalidAlgorithm
                }
                algorithm = parsed
            case "digits":
                digits = try strictDecimal(decoded, error: .invalidDigits)
                guard digits == 6 || digits == 8 else {
                    throw TOTPProvisioningError.invalidDigits
                }
            case "period":
                period = try strictDecimal(decoded, error: .invalidPeriod)
                guard TOTPGenerator.supportedPeriodSeconds.contains(period) else {
                    throw TOTPProvisioningError.invalidPeriod
                }
            default:
                throw TOTPProvisioningError.unknownParameter
            }
        }

        guard var encodedSecret = secretText else {
            throw TOTPProvisioningError.missingSecret
        }
        defer { encodedSecret.resetBytes(in: encodedSecret.startIndex..<encodedSecret.endIndex) }
        var secret = try decodeBase32(encodedSecret)
        guard (10...128).contains(secret.count) else {
            secret.resetBytes(in: secret.startIndex..<secret.endIndex)
            throw TOTPProvisioningError.invalidSecret
        }
        if let labelIssuer, let issuer, labelIssuer != issuer {
            secret.resetBytes(in: secret.startIndex..<secret.endIndex)
            throw TOTPProvisioningError.issuerMismatch
        }
        guard !Task.isCancelled else {
            secret.resetBytes(in: secret.startIndex..<secret.endIndex)
            throw TOTPProvisioningError.cancelled
        }
        return TOTPProvisioning(
            metadata: TOTPProvisioningMetadata(
                issuer: issuer ?? labelIssuer,
                accountName: account,
                algorithm: algorithm,
                digits: digits,
                period: period
            ),
            secret: TOTPProvisioningSecretLease(bytes: secret)
        )
    }

    private static func decodedText(
        _ raw: Data,
        error: TOTPProvisioningError
    ) throws -> String {
        var decoded = try percentDecode(raw, error: error)
        defer { decoded.resetBytes(in: decoded.startIndex..<decoded.endIndex) }
        guard let text = String(data: decoded, encoding: .utf8) else { throw error }
        return text
    }

    private static func clearOptionalData(_ value: inout Data?) {
        guard var material = value else { return }
        value = nil
        material.resetBytes(in: material.startIndex..<material.endIndex)
    }

    private static func percentDecode(
        _ raw: Data,
        error: TOTPProvisioningError
    ) throws -> Data {
        var result = Data()
        result.reserveCapacity(raw.count)
        var index = raw.startIndex
        while index < raw.endIndex {
            let byte = raw[index]
            if byte == 0x25 {
                guard raw.distance(from: index, to: raw.endIndex) >= 3 else { throw error }
                let first = raw[raw.index(after: index)]
                let secondIndex = raw.index(index, offsetBy: 2)
                guard let high = hex(first), let low = hex(raw[secondIndex]) else { throw error }
                result.append(high << 4 | low)
                index = raw.index(index, offsetBy: 3)
            } else {
                guard byte < 128 else { throw error }
                result.append(byte)
                index = raw.index(after: index)
            }
        }
        return result
    }

    private static func hex(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 48...57: return byte - 48
        case 65...70: return byte - 55
        case 97...102: return byte - 87
        default: return nil
        }
    }

    private static func boundedLabelText(_ bytes: Data) throws -> String {
        guard let value = String(data: bytes, encoding: .utf8) else {
            throw TOTPProvisioningError.invalidLabel
        }
        return try boundedLabel(value)
    }

    private static func boundedLabel(_ value: String) throws -> String {
        guard !value.isEmpty,
              value.utf16.count <= maximumLabelCharacters,
              value.trimmingCharacters(in: .whitespacesAndNewlines) == value,
              !value.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) else {
            throw TOTPProvisioningError.invalidLabel
        }
        return value
    }

    private static func strictDecimal(
        _ bytes: Data,
        error: TOTPProvisioningError
    ) throws -> Int {
        guard !bytes.isEmpty, bytes.count <= 3, bytes.allSatisfy({ (48...57).contains($0) }),
              bytes.first != 48 else {
            throw error
        }
        return bytes.reduce(0) { $0 * 10 + Int($1 - 48) }
    }

    private static func decodeBase32(_ encoded: Data) throws -> Data {
        guard !encoded.isEmpty, encoded.count <= 205 else {
            throw TOTPProvisioningError.invalidSecret
        }
        var output = Data()
        output.reserveCapacity(encoded.count * 5 / 8)
        var accumulator: UInt32 = 0
        var bits = 0
        for byte in encoded {
            guard !Task.isCancelled else {
                output.resetBytes(in: output.startIndex..<output.endIndex)
                throw TOTPProvisioningError.cancelled
            }
            let uppercase = (97...122).contains(byte) ? byte - 32 : byte
            let value: UInt32
            switch uppercase {
            case 65...90: value = UInt32(uppercase - 65)
            case 50...55: value = UInt32(uppercase - 24)
            default:
                output.resetBytes(in: output.startIndex..<output.endIndex)
                throw TOTPProvisioningError.invalidSecret
            }
            accumulator = (accumulator << 5) | value
            bits += 5
            if bits >= 8 {
                bits -= 8
                output.append(UInt8(truncatingIfNeeded: accumulator >> UInt32(bits)))
                accumulator &= bits == 0 ? 0 : (1 << UInt32(bits)) - 1
            }
        }
        let validResidues: Set<Int> = [0, 2, 4, 5, 7]
        guard validResidues.contains(encoded.count % 8), accumulator == 0 else {
            output.resetBytes(in: output.startIndex..<output.endIndex)
            throw TOTPProvisioningError.invalidSecret
        }
        return output
    }
}
