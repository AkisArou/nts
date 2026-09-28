// swift-tools-version:5.9
// A Swift target: its `@objc` class is what the program reaches.
import PackageDescription

let package = Package(
    name: "Blink",
    platforms: [.macOS(.v13)],
    products: [.library(name: "Blink", targets: ["Blink"])],
    targets: [.target(name: "Blink")]
)
