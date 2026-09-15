// Android and iOS only. The package that asks what a target set *means*.
//
// No `language`, no `direction` -- see `notifications/nts.config.ts` for why
// both were removed. This package is one-directional anyway, which is exactly
// why it is not the place to discover that `direction` was the wrong shape.
//
// `targets` here is a claim, not a preference: there is no biometric prompt on
// a Linux server. A desktop app depending on this must fail at **configuration**
// time, naming this package and the target it cannot satisfy -- not at link time
// with a missing symbol. That check does not exist.
import { defineConfig, sources, manifest } from "@native-typescript/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  targets: ["android-29", "ios-17"],

  native: [
    sources({ dir: "native/android/com/example/biometrics", targets: ["android-29"] }),
    sources({ dir: "native/apple", targets: ["ios-17"] }),
  ],

  manifests: [
    manifest({ target: "android-29", path: "manifests/android.xml" }),
    // Supplies a *key* whose value the consumer must replace. Whether a merged
    // fragment can demand that, rather than silently ship a placeholder into a
    // shipping app, is open.
    manifest({ target: "ios-17", path: "manifests/apple.plist", requiresValue: ["NSFaceIDUsageDescription"] }),
  ],
});
