import CryptoKit
import Foundation

public enum PasskeyAssertionError: String, Error, Equatable, Sendable {
    case invalidRelyingPartyID
    case invalidClientDataHash
    case invalidCredentialID
    case invalidUserHandle
    case unsupportedAlgorithm
    case invalidPrivateKey
    case invalidatedKeyLease
    case signingFailed
    case cancelled
}

public struct PasskeyAssertion: Equatable, Sendable {
    public let credentialID: Data
    public let authenticatorData: Data
    public let signatureDER: Data
    public let userHandle: Data
}

public enum PasskeyAssertionSigner {
    public static let es256Algorithm = -7

    private static let maximumRPIDBytes = 253
    private static let maximumRPIDLabelBytes = 63
    private static let maximumCredentialIDBytes = 1_023
    private static let maximumUserHandleBytes = 64
    private static let userPresentAndVerifiedFlags: UInt8 = 0x05

    /// Signs one assertion after the caller has independently completed user
    /// presence and user verification. The private-key buffer is consumed and
    /// cleared once all public inputs pass validation.
    public static func signAfterUserPresenceAndVerification(
        relyingPartyID: String,
        clientDataHash: Data,
        credentialID: Data,
        userHandle: Data,
        algorithm: Int,
        consumingPrivateKey privateKey: inout Data
    ) throws -> PasskeyAssertion {
        try validateRelyingPartyID(relyingPartyID)
        guard clientDataHash.count == 32 else {
            throw PasskeyAssertionError.invalidClientDataHash
        }
        guard (1...maximumCredentialIDBytes).contains(credentialID.count) else {
            throw PasskeyAssertionError.invalidCredentialID
        }
        guard (1...maximumUserHandleBytes).contains(userHandle.count) else {
            throw PasskeyAssertionError.invalidUserHandle
        }
        guard algorithm == es256Algorithm else {
            throw PasskeyAssertionError.unsupportedAlgorithm
        }
        try requireActiveTask()

        let lease = try PasskeyPrivateKeyLease(consuming: &privateKey)
        defer { lease.invalidate() }

        var authenticatorData = Data(SHA256.hash(data: Data(relyingPartyID.utf8)))
        authenticatorData.append(userPresentAndVerifiedFlags)
        authenticatorData.append(contentsOf: [0, 0, 0, 0])
        var signedBytes = authenticatorData
        signedBytes.append(clientDataHash)
        defer { signedBytes.resetBytes(in: signedBytes.startIndex..<signedBytes.endIndex) }

        try requireActiveTask()
        let signature = try lease.signDER(message: signedBytes)
        try requireActiveTask()
        return PasskeyAssertion(
            credentialID: credentialID,
            authenticatorData: authenticatorData,
            signatureDER: signature,
            userHandle: userHandle
        )
    }

    static func validateRelyingPartyID(_ relyingPartyID: String) throws {
        let bytes = Array(relyingPartyID.utf8)
        guard !bytes.isEmpty,
              bytes.count <= maximumRPIDBytes,
              bytes.count == relyingPartyID.count,
              relyingPartyID == relyingPartyID.lowercased(),
              relyingPartyID.first != ".",
              relyingPartyID.last != "." else {
            throw PasskeyAssertionError.invalidRelyingPartyID
        }
        let labels = relyingPartyID.split(separator: ".", omittingEmptySubsequences: false)
        guard !labels.isEmpty,
              !labels.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }) else {
            throw PasskeyAssertionError.invalidRelyingPartyID
        }
        for label in labels {
            let labelBytes = Array(label.utf8)
            guard !labelBytes.isEmpty,
                  labelBytes.count <= maximumRPIDLabelBytes,
                  labelBytes.first != 45,
                  labelBytes.last != 45,
                  labelBytes.allSatisfy({ byte in
                      (97...122).contains(byte) || (48...57).contains(byte) || byte == 45
                  }) else {
                throw PasskeyAssertionError.invalidRelyingPartyID
            }
        }
    }

    private static func requireActiveTask() throws {
        guard !Task.isCancelled else { throw PasskeyAssertionError.cancelled }
    }
}

final class PasskeyPrivateKeyLease: @unchecked Sendable {
    private let lock = NSLock()
    private var keyMaterial: Data
    private var isInvalidated = false

    init(consuming privateKey: inout Data) throws {
        var material = Data(privateKey)
        privateKey.resetBytes(in: privateKey.startIndex..<privateKey.endIndex)
        guard material.count == 32 else {
            material.resetBytes(in: material.startIndex..<material.endIndex)
            throw PasskeyAssertionError.invalidPrivateKey
        }
        do {
            _ = try P256.Signing.PrivateKey(rawRepresentation: material)
        } catch {
            material.resetBytes(in: material.startIndex..<material.endIndex)
            throw PasskeyAssertionError.invalidPrivateKey
        }
        keyMaterial = material
    }

    deinit {
        invalidate()
    }

    func signDER(message: Data) throws -> Data {
        lock.lock()
        defer {
            keyMaterial.resetBytes(in: keyMaterial.startIndex..<keyMaterial.endIndex)
            isInvalidated = true
            lock.unlock()
        }
        guard !isInvalidated else { throw PasskeyAssertionError.invalidatedKeyLease }
        guard !Task.isCancelled else { throw PasskeyAssertionError.cancelled }
        do {
            let key = try P256.Signing.PrivateKey(rawRepresentation: keyMaterial)
            let signature = try key.signature(for: message)
            guard !Task.isCancelled else { throw PasskeyAssertionError.cancelled }
            return signature.derRepresentation
        } catch let error as PasskeyAssertionError {
            throw error
        } catch {
            throw PasskeyAssertionError.signingFailed
        }
    }

    func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        guard !isInvalidated else { return }
        keyMaterial.resetBytes(in: keyMaterial.startIndex..<keyMaterial.endIndex)
        isInvalidated = true
    }
}
