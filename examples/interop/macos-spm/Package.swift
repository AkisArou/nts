// swift-tools-version:5.9
// The Swift packages the program uses, as an app's Package.swift declares
// them. `nts build` reads this with SwiftPM's own `swift-package
// dump-package`, and never resolves: both are local packages, which SwiftPM
// pins nothing for, so Package.resolved is empty.
import PackageDescription

let package = Package(
    name: "Host",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "Packages/Tally"),
        .package(path: "Packages/Blink"),
    ],
    targets: []
)
