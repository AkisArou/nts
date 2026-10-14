// swift-tools-version:5.9
// A package that ships only a binary, downloaded by `url:` and checked
// against its checksum -- the shape most closed-source SDKs take. `make.sh`
// makes it; the URL is not a server's (see there).
import PackageDescription

let package = Package(
    name: "Buzz",
    platforms: [.macOS(.v13)],
    products: [.library(name: "Buzz", targets: ["Buzz"])],
    targets: [
        .binaryTarget(
            name: "Buzz",
            url: "https://example.invalid/Buzz.xcframework.zip",
            checksum: "0340b3cc1c8698bbad44c4e31c9c7dd6da9fded109a19c09a5c1a32d1a90bf45"
        ),
    ]
)
