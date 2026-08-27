import Foundation

/// Identifies one field without allowing a key-only duplicate-field lookup.
/// A stable field ID is authoritative when present. Legacy fields require the
/// authenticated array position and key observed in the value-free detail.
public struct CredentialFieldSelector: Equatable, Sendable {
    public let credentialID: String
    public let fieldID: String?
    public let position: Int
    public let key: String

    public init(credentialID: String, fieldID: String?, position: Int, key: String) {
        self.credentialID = credentialID
        self.fieldID = fieldID
        self.position = position
        self.key = key
    }
}

/// A short-lived, explicitly invalidatable UTF-8 value. The value is never
/// exposed as a property. Platform adapters receive an immutable String only
/// for the duration of a synchronous use closure, then the mutable scratch and
/// retained bytes are cleared.
public final class CredentialFieldValueLease: @unchecked Sendable {
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

    public func withUTF8String<Result>(_ use: (String) throws -> Result) throws -> Result {
        lock.lock()
        defer { lock.unlock() }
        guard !invalidated else { throw VaultageCoreError.fieldLeaseInvalidated }
        var scratch = Data(bytes)
        defer { scratch.resetBytes(in: scratch.startIndex..<scratch.endIndex) }
        guard let value = String(data: scratch, encoding: .utf8) else {
            throw VaultageCoreError.invalidRecord
        }
        return try use(value)
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
