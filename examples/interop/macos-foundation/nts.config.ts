// Foundation from TypeScript: Objective-C messages sent from a compiled
// program, on macOS x86_64 (run on the lane's Mac) and arm64 (linked and
// inspected only; tooling/apple/vm.md says why).
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    foundation: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same program through the LLVM backend, linked by `nts build` with
    // the C runtime, main and host units, as the C product is.
    foundationLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
