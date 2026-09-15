// One C implementation, no per-platform variants, no manifests, no external
// dependencies. The floor of what a native package needs to say.
//
// Worth comparing against `notifications`: "has native code" and "has five
// copies of it, four languages, four manifests and two lockfiles" are different
// facts, and a config that made the simple case pay for the complex one would be
// the wrong shape.
import { defineConfig, sources } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  targets: ["android-29", "ios-17", "macos-14", "linux-gnu", "windows", "node-addon"],
  native: [
    // No `targets`: compiled for every target the consumer builds.
    sources({ dir: "native", header: "native/digest.h" }),
  ],
});
