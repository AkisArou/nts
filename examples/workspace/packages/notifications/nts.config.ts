// Notifications: five platforms, two native languages, and a callback.
//
// This is the package the fixture exists for. It needs a config because it has
// native sources that must be compiled and bound; `storage` and `telemetry`
// have none and have no config, which is the rule.
//
// **`direction` is declared, not inferred.** `docs/nts-config.md` §6 records
// the cycle: `ts-calls-native` needs bindings generated before the TypeScript
// is checked, and `native-calls-ts` needs this package's emitted artefacts
// before the native compiles. This package needs both -- scheduling goes out,
// a tap comes back -- so neither order works for both roots and a path cannot
// say which is which.
import { defineConfig, sources } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",

  // No `products`: a package is not an artifact. The app that depends on it
  // decides what gets built, and for which target.
  targets: ["android-29", "ios-17", "macos-14", "linux-gnu", "windows"],

  native: [
    sources({
      dir: "native/android/com/example/notifications",
      language: "java",
      targets: ["android-29"],
      direction: "ts-calls-native",
    }),
    sources({
      // The tap handler. Android delivers it on a Looper thread, which is a
      // *foreign* thread to the runtime -- `NtsInbox` territory, not a direct
      // call. Declared separately from the root above because its direction is
      // the opposite one.
      dir: "native/android/com/example/notifications",
      language: "java",
      targets: ["android-29"],
      direction: "native-calls-ts",
      entry: "onNotificationTapped",
    }),
    sources({
      dir: "native/apple",
      language: "c",
      targets: ["ios-17", "macos-14"],
      direction: "ts-calls-native",
      // Honest: the real API here is Objective-C. This compiler binds C
      // headers, so the shim is C and something else has to bridge it.
      header: "native/apple/scheduler.h",
    }),
    sources({ dir: "native/linux", language: "c", targets: ["linux-gnu"], direction: "ts-calls-native", header: "native/linux/scheduler.h" }),
    sources({ dir: "native/windows", language: "c", targets: ["windows"], direction: "ts-calls-native", header: "native/windows/scheduler.h" }),
  ],
});
