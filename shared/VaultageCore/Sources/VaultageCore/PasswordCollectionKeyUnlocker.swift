import CoreFoundation
import CryptoKit
import Foundation

public enum PasswordUnlockError: String, Error, Equatable, Sendable {
    case invalidParameters
    case unsupportedVersion
    case resourceLimitExceeded
    case invalidWrappedCollectionKey
    case authenticationFailed
    case cancelled
}

public struct PasswordUnlockParameters: Equatable, Sendable {
    public let cost: Int
    public let blockSize: Int
    public let parallelization: Int
    public let keyLength: Int
    public let salt: Data

    private static let maximumJSONBytes = 64 * 1024
    private static let maximumCost = 131_072
    private static let maximumBlockSize = 8
    private static let maximumMemoryBytes = 128 * 1024 * 1024

    public static func parse(json: Data) throws -> PasswordUnlockParameters {
        guard !json.isEmpty, json.count <= maximumJSONBytes else {
            throw PasswordUnlockError.invalidParameters
        }

        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: json)
        } catch {
            throw PasswordUnlockError.invalidParameters
        }
        guard let root = value as? [String: Any] else {
            throw PasswordUnlockError.invalidParameters
        }
        guard try exactInteger(root["version"]) == 2 else {
            throw PasswordUnlockError.unsupportedVersion
        }
        guard let scrypt = root["scrypt"] as? [String: Any],
              Set(["N", "r", "p", "salt"]).isSubset(of: Set(scrypt.keys)) else {
            throw PasswordUnlockError.invalidParameters
        }

        let cost = try exactInteger(scrypt["N"])
        let blockSize = try exactInteger(scrypt["r"])
        let parallelization = try exactInteger(scrypt["p"])
        let keyLength = try scrypt["keylen"].map(exactInteger) ?? 32
        guard cost >= 2,
              cost <= maximumCost,
              cost.nonzeroBitCount == 1,
              blockSize >= 1,
              blockSize <= maximumBlockSize,
              parallelization == 1,
              keyLength == 32,
              let saltText = scrypt["salt"] as? String,
              let salt = decodeShippingHex(saltText),
              (16...128).contains(salt.count) else {
            throw PasswordUnlockError.invalidParameters
        }

        let costTimesBlockSizeResult = cost.multipliedReportingOverflow(by: blockSize)
        guard !costTimesBlockSizeResult.overflow else {
            throw PasswordUnlockError.resourceLimitExceeded
        }
        let memoryBytesResult = costTimesBlockSizeResult.partialValue.multipliedReportingOverflow(by: 128)
        guard !memoryBytesResult.overflow, memoryBytesResult.partialValue <= maximumMemoryBytes else {
            throw PasswordUnlockError.resourceLimitExceeded
        }
        return PasswordUnlockParameters(
            cost: cost,
            blockSize: blockSize,
            parallelization: parallelization,
            keyLength: keyLength,
            salt: salt
        )
    }

    private static func exactInteger(_ value: Any?) throws -> Int {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded(.towardZero) == number.doubleValue,
              number.doubleValue >= Double(Int.min),
              number.doubleValue <= Double(Int.max) else {
            throw PasswordUnlockError.invalidParameters
        }
        return number.intValue
    }

    private static func decodeShippingHex(_ text: String) -> Data? {
        let bytes = Array(text.utf8)
        guard bytes.count == text.count, bytes.count.isMultiple(of: 2) else { return nil }
        var decoded = Data(capacity: bytes.count / 2)
        var index = 0
        while index < bytes.count {
            guard let high = hexNibble(bytes[index]), let low = hexNibble(bytes[index + 1]) else {
                return nil
            }
            decoded.append((high << 4) | low)
            index += 2
        }
        return decoded
    }

    private static func hexNibble(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 48...57: byte - 48
        case 65...70: byte - 55
        case 97...102: byte - 87
        default: nil
        }
    }
}

public enum PasswordCollectionKeyUnlocker {
    /// Opens the 32-byte collection key. The caller retains ownership of the
    /// mutable password buffer and is responsible for clearing it after use.
    public static func unlock(
        wrappedCollectionKey: Data,
        parametersJSON: Data,
        passwordUTF8: inout Data
    ) throws -> Data {
        let parameters = try PasswordUnlockParameters.parse(json: parametersJSON)
        guard wrappedCollectionKey.count == 60 else {
            throw PasswordUnlockError.invalidWrappedCollectionKey
        }

        var derivedKey = try Scrypt.derive(
            password: passwordUTF8,
            salt: parameters.salt,
            cost: parameters.cost,
            blockSize: parameters.blockSize,
            parallelization: parameters.parallelization,
            outputByteCount: parameters.keyLength
        )
        defer { derivedKey.resetBytes(in: derivedKey.startIndex..<derivedKey.endIndex) }

        do {
            let nonce = try AES.GCM.Nonce(data: wrappedCollectionKey.prefix(12))
            let box = try AES.GCM.SealedBox(
                nonce: nonce,
                ciphertext: wrappedCollectionKey.dropFirst(28),
                tag: wrappedCollectionKey.dropFirst(12).prefix(16)
            )
            var collectionKey = try AES.GCM.open(box, using: SymmetricKey(data: derivedKey))
            guard collectionKey.count == 32 else {
                collectionKey.resetBytes(in: collectionKey.startIndex..<collectionKey.endIndex)
                throw PasswordUnlockError.invalidWrappedCollectionKey
            }
            return collectionKey
        } catch let error as PasswordUnlockError {
            throw error
        } catch {
            throw PasswordUnlockError.authenticationFailed
        }
    }
}
