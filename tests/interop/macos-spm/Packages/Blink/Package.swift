// swift-tools-version:5.9
// A Swift target: its `@objc` class is what the program reaches. It imports
// `CBlink`, a C target of the same package, whose public header includes
// another's, `CBlinkCore` -- the shape of a package wrapping a C library.
import PackageDescription

let package = Package(
    name: "Blink",
    platforms: [.macOS(.v13)],
    products: [.library(name: "Blink", targets: ["Blink"])],
    targets: [
        .target(name: "Blink", dependencies: ["CBlink"]),
        .target(name: "CBlink", dependencies: ["CBlinkCore"]),
        .target(name: "CBlinkCore"),
    ]
)
