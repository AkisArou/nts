// swift-tools-version:5.9
// The Swift packages the program uses, as an app's Package.swift declares
// them. `nts build` reads this with SwiftPM's own `swift-package
// dump-package`, and never resolves: all three are local packages, which
// SwiftPM pins nothing for, so Package.resolved is empty. One, Buzz, is a
// binary downloaded by `url:`: what `swift package resolve` left for it is in
// .build (Packages/Buzz/make.sh).
import PackageDescription

let package = Package(
    name: "Host",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "Packages/Tally"),
        .package(path: "Packages/Blink"),
        .package(path: "Packages/Buzz"),
    ],
    targets: []
)
