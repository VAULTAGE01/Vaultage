import Foundation

public struct CredentialListProjection: Equatable, Sendable {
    public let vaultID: String
    public let vaultName: String
    public let credentials: [CredentialListItem]

    public init(vaultID: String, vaultName: String, credentials: [CredentialListItem]) {
        self.vaultID = vaultID
        self.vaultName = vaultName
        self.credentials = credentials
    }
}

public struct CredentialListItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let type: String
    public let createdAt: String
    public let updatedAt: String
    public let folderPath: [String]
    public let fieldCount: Int

    public init(
        id: String,
        name: String,
        type: String,
        createdAt: String,
        updatedAt: String,
        folderPath: [String],
        fieldCount: Int
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.folderPath = folderPath
        self.fieldCount = fieldCount
    }
}
