// swift-tools-version:5.9
// **Their file.** An existing SwiftPM package that adds us as a binary target.
//
// `binaryTarget` is the only way SwiftPM consumes a prebuilt XCFramework, and it
// requires a checksum -- which is the same supply-chain position
// `dependencies.tsv` takes for Gradle, arrived at independently by Apple.
import PackageDescription

let package = Package(
    name: "AcmeApp",
    platforms: [.iOS(.v17)],
    targets: [
        .binaryTarget(
            name: "AcmeSdk",
            url: "https://acme.example/AcmeSdk-0.1.0.xcframework.zip",
            checksum: "0000000000000000000000000000000000000000000000000000000000000000"
        ),
        .target(name: "AcmeApp", dependencies: ["AcmeSdk"]),
    ]
)
