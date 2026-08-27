import Foundation

/// Authenticated metadata for one credential. Field values, notes, and other
/// release-capable plaintext intentionally do not cross this boundary.
public struct CredentialDetailProjection: Equatable, Sendable {
    public let vaultID: String
    public let vaultName: String
    public let credential: CredentialDetail

    public init(vaultID: String, vaultName: String, credential: CredentialDetail) {
        self.vaultID = vaultID
        self.vaultName = vaultName
        self.credential = credential
    }
}

public struct CredentialDetail: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let type: String
    public let createdAt: String
    public let updatedAt: String
    public let folderPath: [String]
    public let scope: String?
    public let tags: [String]
    public let expiresAt: String?
    public let accessPolicy: CredentialAccessPolicy
    public let fields: [CredentialFieldDescriptor]

    public init(
        id: String,
        name: String,
        type: String,
        createdAt: String,
        updatedAt: String,
        folderPath: [String],
        scope: String?,
        tags: [String],
        expiresAt: String?,
        accessPolicy: CredentialAccessPolicy,
        fields: [CredentialFieldDescriptor]
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.folderPath = folderPath
        self.scope = scope
        self.tags = tags
        self.expiresAt = expiresAt
        self.accessPolicy = accessPolicy
        self.fields = fields
    }
}

public struct CredentialFieldDescriptor: Equatable, Sendable {
    /// Stable when the shipping record has a field ID. Legacy fields remain
    /// addressable only by their duplicate-preserving array position and key.
    public let id: String?
    public let position: Int
    public let key: String
    public let sensitive: Bool
    public let hasValue: Bool

    public init(id: String?, position: Int, key: String, sensitive: Bool, hasValue: Bool) {
        self.id = id
        self.position = position
        self.key = key
        self.sensitive = sensitive
        self.hasValue = hasValue
    }
}

public struct CredentialAccessPolicy: Equatable, Sendable {
    public let browserExtension: Bool
    public let agent: Bool
    public let revealCopy: Bool
    public let cliExport: Bool

    public init(browserExtension: Bool, agent: Bool, revealCopy: Bool, cliExport: Bool) {
        self.browserExtension = browserExtension
        self.agent = agent
        self.revealCopy = revealCopy
        self.cliExport = cliExport
    }
}
