// swift-tools-version:5.9
// An Objective-C target: its public headers are `include/`, as SwiftPM's are.
import PackageDescription

let package = Package(
    name: "Tally",
    platforms: [.macOS(.v13)],
    products: [.library(name: "Tally", targets: ["Tally"])],
    targets: [
        .target(name: "Tally", linkerSettings: [.linkedFramework("CoreFoundation")]),
    ]
)
