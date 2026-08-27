import Foundation

public struct VaultCollectionProjection: Equatable, Sendable {
    public let storageVersion: Int
    public let revision: Int
    public let activeVaultID: String
    public let vaults: [VaultListItem]

    public init(storageVersion: Int, revision: Int, activeVaultID: String, vaults: [VaultListItem]) {
        self.storageVersion = storageVersion
        self.revision = revision
        self.activeVaultID = activeVaultID
        self.vaults = vaults
    }
}

public struct VaultListItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let createdAt: String
    public let updatedAt: String
    public let isArchived: Bool
    public let recordStorageVersion: Int
    public let vaultVersion: Int
    public let vaultRevision: Int?

    public init(
        id: String,
        name: String,
        createdAt: String,
        updatedAt: String,
        isArchived: Bool,
        recordStorageVersion: Int,
        vaultVersion: Int,
        vaultRevision: Int?
    ) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isArchived = isArchived
        self.recordStorageVersion = recordStorageVersion
        self.vaultVersion = vaultVersion
        self.vaultRevision = vaultRevision
    }
}

public enum VaultageCoreError: String, Error, Equatable, Sendable {
    case invalidKey
    case invalidEnvelope
    case authenticationFailed
    case payloadTooLarge
    case invalidJSON
    case invalidCollection
    case unsupportedCollectionVersion
    case invalidRecordManifest
    case vaultNotFound
    case invalidWrappedKey
    case recordMissing
    case recordAuthenticationFailed
    case recordContentMismatch
    case recordStorageVersionMismatch
    case invalidRecord
    case recordLimitExceeded
    case credentialNotFound
    case fieldNotFound
    case fieldReleaseDenied
    case fieldValueTooLarge
    case fieldLeaseInvalidated
}
