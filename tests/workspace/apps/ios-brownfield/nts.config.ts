// **Brownfield: an existing iOS app consumes us.**
//
// The artifact Apple's toolchains resolve is an **XCFramework** -- a bundle of
// per-architecture slices plus a module map, which is what lets Xcode link it
// for device and simulator from one dependency. A `.dylib` is not that, and
// neither is a directory of objects.
//
// Two things differ from Android beyond the file format:
//   - **Swift needs a module to import**, so we emit a module map and a
//     generated header. That is the same mechanism `swiftc -emit-objc-header`
//     uses in the other direction, run the other way round.
//   - **Info.plist fragments cannot merge.** Android has a manifest merger with
//     a specification; Apple has no equivalent, so our plist keys are something
//     the consumer must copy. `packages/notifications/manifests/apple.plist`
//     assumes a merger that does not exist, and this app is where that shows.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    sdk: library.xcframework({
      targets: [target.ios({ minimumVersion: "17.0" })],
      entry: "./nts/sdk.ts",
      // The Swift module name a consumer writes `import AcmeSdk` for.
      moduleName: "AcmeSdk",
    }),
  },
  // A SwiftPM `buildToolPlugin`. Same job as the Gradle plugin and a different
  // sandbox: a SwiftPM plugin cannot write outside its work directory, so the
  // XCFramework is a declared output rather than something we drop in place.
  integrate: ["swiftpm"],
});
