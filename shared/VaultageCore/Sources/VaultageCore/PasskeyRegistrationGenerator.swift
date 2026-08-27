import CryptoKit
import Foundation

public enum PasskeyRegistrationError: String, Error, Equatable, Sendable {
    case invalidRelyingPartyID
    case invalidClientDataHash
    case unsupportedAlgorithm
    case invalidCredentialID
    case invalidAAGUID
    case invalidPrivateKey
    case privateKeyNotConsumed
    case cancelled
}

public struct PasskeyRegistration: Equatable, Sendable {
    public let credentialID: Data
    public let attestationObject: Data
    public let algorithm: Int

    init(credentialID: Data, attestationObject: Data, algorithm: Int) {
        self.credentialID = credentialID
        self.attestationObject = attestationObject
        self.algorithm = algorithm
    }
}

public enum PasskeyRegistrationGenerator {
    public static let es256Algorithm = -7

    private static let generatedCredentialIDBytes = 32
    private static let maximumSupportedAlgorithms = 64
    private static let noAttestationAAGUID = Data(repeating: 0, count: 16)
    private static let userPresentVerifiedAttestedFlags: UInt8 = 0x45

    /// Creates public ES256 registration material after the caller has
    /// independently completed user presence and verification. The storage
    /// closure must synchronously consume and clear the raw private scalar.
    public static func createAfterUserPresenceAndVerification(
        relyingPartyID: String,
        clientDataHash: Data,
        supportedAlgorithms: [Int],
        storingPrivateKey: (inout Data, PasskeyRegistration) throws -> Void
    ) throws -> PasskeyRegistration {
        try validatePublicInputs(
            relyingPartyID: relyingPartyID,
            clientDataHash: clientDataHash,
            supportedAlgorithms: supportedAlgorithms
        )
        try requireActiveTask()

        let privateKey = P256.Signing.PrivateKey()
        var rawPrivateKey = privateKey.rawRepresentation
        var credentialID = Data(count: generatedCredentialIDBytes)
        var random = SystemRandomNumberGenerator()
        for index in credentialID.indices {
            credentialID[index] = UInt8.random(in: .min ... .max, using: &random)
        }
        return try makeDeterministicAfterUserPresenceAndVerification(
            relyingPartyID: relyingPartyID,
            clientDataHash: clientDataHash,
            supportedAlgorithms: supportedAlgorithms,
            credentialID: credentialID,
            aaguid: noAttestationAAGUID,
            consumingPrivateKey: &rawPrivateKey,
            storingPrivateKey: storingPrivateKey
        )
    }

    static func makeDeterministicAfterUserPresenceAndVerification(
        relyingPartyID: String,
        clientDataHash: Data,
        supportedAlgorithms: [Int],
        credentialID: Data,
        aaguid: Data,
        consumingPrivateKey privateKey: inout Data,
        storingPrivateKey: (inout Data, PasskeyRegistration) throws -> Void
    ) throws -> PasskeyRegistration {
        try validatePublicInputs(
            relyingPartyID: relyingPartyID,
            clientDataHash: clientDataHash,
            supportedAlgorithms: supportedAlgorithms
        )
        guard (1...1_023).contains(credentialID.count) else {
            throw PasskeyRegistrationError.invalidCredentialID
        }
        guard aaguid.count == 16 else {
            throw PasskeyRegistrationError.invalidAAGUID
        }
        try requireActiveTask()

        defer { privateKey.resetBytes(in: privateKey.startIndex..<privateKey.endIndex) }
        guard privateKey.count == 32,
              let signingKey = try? P256.Signing.PrivateKey(rawRepresentation: privateKey) else {
            throw PasskeyRegistrationError.invalidPrivateKey
        }

        let publicKey = signingKey.publicKey.x963Representation
        guard publicKey.count == 65, publicKey.first == 0x04 else {
            throw PasskeyRegistrationError.invalidPrivateKey
        }
        let x = publicKey.subdata(in: 1..<33)
        let y = publicKey.subdata(in: 33..<65)
        let coseKey = encodeES256COSEKey(x: x, y: y)

        var authenticatorData = Data(SHA256.hash(data: Data(relyingPartyID.utf8)))
        authenticatorData.append(userPresentVerifiedAttestedFlags)
        authenticatorData.append(contentsOf: [0, 0, 0, 0])
        authenticatorData.append(aaguid)
        authenticatorData.append(UInt8(credentialID.count >> 8))
        authenticatorData.append(UInt8(credentialID.count & 0xff))
        authenticatorData.append(credentialID)
        authenticatorData.append(coseKey)

        let registration = PasskeyRegistration(
            credentialID: credentialID,
            attestationObject: encodeNoneAttestation(authenticatorData: authenticatorData),
            algorithm: es256Algorithm
        )
        try requireActiveTask()
        try storingPrivateKey(&privateKey, registration)
        guard privateKey.count == 32, privateKey.allSatisfy({ $0 == 0 }) else {
            throw PasskeyRegistrationError.privateKeyNotConsumed
        }
        return registration
    }

    private static func validatePublicInputs(
        relyingPartyID: String,
        clientDataHash: Data,
        supportedAlgorithms: [Int]
    ) throws {
        do {
            try PasskeyAssertionSigner.validateRelyingPartyID(relyingPartyID)
        } catch {
            throw PasskeyRegistrationError.invalidRelyingPartyID
        }
        guard clientDataHash.count == 32 else {
            throw PasskeyRegistrationError.invalidClientDataHash
        }
        guard (1...maximumSupportedAlgorithms).contains(supportedAlgorithms.count),
              supportedAlgorithms.contains(es256Algorithm) else {
            throw PasskeyRegistrationError.unsupportedAlgorithm
        }
    }

    private static func requireActiveTask() throws {
        guard !Task.isCancelled else { throw PasskeyRegistrationError.cancelled }
    }

    private static func encodeES256COSEKey(x: Data, y: Data) -> Data {
        var encoded = Data([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21])
        appendByteString(x, to: &encoded)
        encoded.append(0x22)
        appendByteString(y, to: &encoded)
        return encoded
    }

    private static func encodeNoneAttestation(authenticatorData: Data) -> Data {
        var encoded = Data([0xa3])
        appendText("fmt", to: &encoded)
        appendText("none", to: &encoded)
        appendText("attStmt", to: &encoded)
        encoded.append(0xa0)
        appendText("authData", to: &encoded)
        appendByteString(authenticatorData, to: &encoded)
        return encoded
    }

    private static func appendText(_ value: String, to data: inout Data) {
        let bytes = Data(value.utf8)
        appendHeader(majorType: 3, length: bytes.count, to: &data)
        data.append(bytes)
    }

    private static func appendByteString(_ value: Data, to data: inout Data) {
        appendHeader(majorType: 2, length: value.count, to: &data)
        data.append(value)
    }

    private static func appendHeader(majorType: UInt8, length: Int, to data: inout Data) {
        if length < 24 {
            data.append((majorType << 5) | UInt8(length))
        } else if length <= Int(UInt8.max) {
            data.append((majorType << 5) | 24)
            data.append(UInt8(length))
        } else {
            data.append((majorType << 5) | 25)
            data.append(UInt8((length >> 8) & 0xff))
            data.append(UInt8(length & 0xff))
        }
    }
}
