// One C implementation, no per-platform variants. The simplest native case.
//
// Here to show that "has native code" and "has five copies of it" are different
// facts. `notifications` needs a source root per platform because the API
// differs; this needs one because the algorithm does not.
import { defineConfig, sources } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  targets: ["android-29", "ios-17", "macos-14", "linux-gnu", "windows", "node-addon"],
  native: [
    sources({
      dir: "native",
      language: "c",
      // No `targets`: this compiles for every target the consumer builds.
      direction: "ts-calls-native",
      header: "native/digest.h",
    }),
  ],
});
