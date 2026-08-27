import CryptoKit
import Foundation

enum Scrypt {
    static func derive(
        password: Data,
        salt: Data,
        cost: Int,
        blockSize: Int,
        parallelization: Int,
        outputByteCount: Int,
        onROMixCheckpoint: (@Sendable () -> Void)? = nil
    ) throws -> Data {
        guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }
        guard cost >= 2, cost.nonzeroBitCount == 1,
              blockSize > 0, parallelization > 0, outputByteCount > 0,
              let oneBlockBytes = checkedMultiply(128, blockSize),
              let initialBytes = checkedMultiply(oneBlockBytes, parallelization),
              let blockWords = checkedMultiply(32, blockSize),
              let vWords = checkedMultiply(blockWords, cost) else {
            throw PasswordUnlockError.resourceLimitExceeded
        }

        var expanded = try pbkdf2SHA256(
            password: password,
            salt: salt,
            outputByteCount: initialBytes
        )
        defer { expanded.resetBytes(in: expanded.startIndex..<expanded.endIndex) }
        guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }

        for lane in 0..<parallelization {
            let byteStart = lane * oneBlockBytes
            var words = littleEndianWords(expanded[byteStart..<(byteStart + oneBlockBytes)])
            defer { clear(&words) }
            try romix(
                &words,
                cost: cost,
                blockSize: blockSize,
                vWords: vWords,
                onCheckpoint: onROMixCheckpoint
            )
            storeLittleEndian(words, into: &expanded, startingAt: byteStart)
        }

        return try pbkdf2SHA256(
            password: password,
            salt: expanded,
            outputByteCount: outputByteCount
        )
    }

    private static func pbkdf2SHA256(
        password: Data,
        salt: Data,
        outputByteCount: Int
    ) throws -> Data {
        let digestBytes = 32
        guard outputByteCount > 0,
              let adjusted = checkedAdd(outputByteCount, digestBytes - 1) else {
            throw PasswordUnlockError.resourceLimitExceeded
        }
        let blocks = adjusted / digestBytes
        guard blocks <= Int(UInt32.max) else { throw PasswordUnlockError.resourceLimitExceeded }

        let key = SymmetricKey(data: password)
        var output = Data(capacity: outputByteCount)
        for block in 1...blocks {
            var message = Data(capacity: salt.count + 4)
            message.append(salt)
            var counter = UInt32(block).bigEndian
            withUnsafeBytes(of: &counter) { message.append(contentsOf: $0) }
            var digest = Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
            message.resetBytes(in: message.startIndex..<message.endIndex)
            let remaining = outputByteCount - output.count
            output.append(digest.prefix(min(digestBytes, remaining)))
            digest.resetBytes(in: digest.startIndex..<digest.endIndex)
        }
        return output
    }

    private static func romix(
        _ words: inout [UInt32],
        cost: Int,
        blockSize: Int,
        vWords: Int,
        onCheckpoint: (@Sendable () -> Void)?
    ) throws {
        guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }
        var v = [UInt32](repeating: 0, count: vWords)
        defer { clear(&v) }
        var x = words
        defer { clear(&x) }

        for iteration in 0..<cost {
            if iteration.isMultiple(of: 64) {
                guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }
                onCheckpoint?()
                guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }
            }
            let start = iteration * words.count
            for offset in x.indices { v[start + offset] = x[offset] }
            blockMix(&x, blockSize: blockSize)
        }
        for iteration in 0..<cost {
            if iteration.isMultiple(of: 64) {
                guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }
                onCheckpoint?()
                guard !Task.isCancelled else { throw PasswordUnlockError.cancelled }
            }
            let lastBlockStart = (2 * blockSize - 1) * 16
            let index = Int(x[lastBlockStart] & UInt32(cost - 1))
            let start = index * words.count
            for offset in x.indices { x[offset] ^= v[start + offset] }
            blockMix(&x, blockSize: blockSize)
        }
        words = x
    }

    private static func blockMix(_ words: inout [UInt32], blockSize: Int) {
        var x = Array(words.suffix(16))
        var y = [UInt32](repeating: 0, count: words.count)
        defer {
            clear(&x)
            clear(&y)
        }
        for block in 0..<(2 * blockSize) {
            let start = block * 16
            for index in 0..<16 { x[index] ^= words[start + index] }
            salsa208(&x)
            for index in 0..<16 { y[start + index] = x[index] }
        }
        for block in 0..<blockSize {
            let source = block * 2 * 16
            let destination = block * 16
            for index in 0..<16 { words[destination + index] = y[source + index] }
        }
        for block in 0..<blockSize {
            let source = (block * 2 + 1) * 16
            let destination = (blockSize + block) * 16
            for index in 0..<16 { words[destination + index] = y[source + index] }
        }
    }

    private static func salsa208(_ block: inout [UInt32]) {
        var x = block
        for _ in 0..<4 {
            x[4] ^= rotate(x[0] &+ x[12], by: 7)
            x[8] ^= rotate(x[4] &+ x[0], by: 9)
            x[12] ^= rotate(x[8] &+ x[4], by: 13)
            x[0] ^= rotate(x[12] &+ x[8], by: 18)
            x[9] ^= rotate(x[5] &+ x[1], by: 7)
            x[13] ^= rotate(x[9] &+ x[5], by: 9)
            x[1] ^= rotate(x[13] &+ x[9], by: 13)
            x[5] ^= rotate(x[1] &+ x[13], by: 18)
            x[14] ^= rotate(x[10] &+ x[6], by: 7)
            x[2] ^= rotate(x[14] &+ x[10], by: 9)
            x[6] ^= rotate(x[2] &+ x[14], by: 13)
            x[10] ^= rotate(x[6] &+ x[2], by: 18)
            x[3] ^= rotate(x[15] &+ x[11], by: 7)
            x[7] ^= rotate(x[3] &+ x[15], by: 9)
            x[11] ^= rotate(x[7] &+ x[3], by: 13)
            x[15] ^= rotate(x[11] &+ x[7], by: 18)

            x[1] ^= rotate(x[0] &+ x[3], by: 7)
            x[2] ^= rotate(x[1] &+ x[0], by: 9)
            x[3] ^= rotate(x[2] &+ x[1], by: 13)
            x[0] ^= rotate(x[3] &+ x[2], by: 18)
            x[6] ^= rotate(x[5] &+ x[4], by: 7)
            x[7] ^= rotate(x[6] &+ x[5], by: 9)
            x[4] ^= rotate(x[7] &+ x[6], by: 13)
            x[5] ^= rotate(x[4] &+ x[7], by: 18)
            x[11] ^= rotate(x[10] &+ x[9], by: 7)
            x[8] ^= rotate(x[11] &+ x[10], by: 9)
            x[9] ^= rotate(x[8] &+ x[11], by: 13)
            x[10] ^= rotate(x[9] &+ x[8], by: 18)
            x[12] ^= rotate(x[15] &+ x[14], by: 7)
            x[13] ^= rotate(x[12] &+ x[15], by: 9)
            x[14] ^= rotate(x[13] &+ x[12], by: 13)
            x[15] ^= rotate(x[14] &+ x[13], by: 18)
        }
        for index in block.indices { block[index] &+= x[index] }
        clear(&x)
    }

    private static func rotate(_ value: UInt32, by count: UInt32) -> UInt32 {
        (value << count) | (value >> (32 - count))
    }

    private static func littleEndianWords(_ bytes: Data.SubSequence) -> [UInt32] {
        var data = Data(bytes)
        defer { data.resetBytes(in: data.startIndex..<data.endIndex) }
        var words = [UInt32](repeating: 0, count: data.count / 4)
        for index in words.indices {
            let offset = index * 4
            words[index] = UInt32(data[offset])
                | (UInt32(data[offset + 1]) << 8)
                | (UInt32(data[offset + 2]) << 16)
                | (UInt32(data[offset + 3]) << 24)
        }
        return words
    }

    private static func storeLittleEndian(_ words: [UInt32], into data: inout Data, startingAt start: Int) {
        for (index, word) in words.enumerated() {
            let offset = start + index * 4
            data[offset] = UInt8(truncatingIfNeeded: word)
            data[offset + 1] = UInt8(truncatingIfNeeded: word >> 8)
            data[offset + 2] = UInt8(truncatingIfNeeded: word >> 16)
            data[offset + 3] = UInt8(truncatingIfNeeded: word >> 24)
        }
    }

    private static func checkedMultiply(_ left: Int, _ right: Int) -> Int? {
        let result = left.multipliedReportingOverflow(by: right)
        return result.overflow ? nil : result.partialValue
    }

    private static func checkedAdd(_ left: Int, _ right: Int) -> Int? {
        let result = left.addingReportingOverflow(right)
        return result.overflow ? nil : result.partialValue
    }

    private static func clear(_ words: inout [UInt32]) {
        for index in words.indices { words[index] = 0 }
    }
}
