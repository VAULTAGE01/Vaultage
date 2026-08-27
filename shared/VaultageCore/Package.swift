// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VaultageCore",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
    ],
    products: [
        .library(name: "VaultageCore", targets: ["VaultageCore"]),
    ],
    targets: [
        .target(name: "VaultageCore"),
        .testTarget(name: "VaultageCoreTests", dependencies: ["VaultageCore"]),
    ]
)
