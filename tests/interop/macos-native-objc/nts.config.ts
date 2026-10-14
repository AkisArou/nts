// A project's own Objective-C, bound from its header and compiled beside the
// program. Run on the lane's Mac against the same program in Objective-C.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    greeter: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same program through the LLVM backend.
    greeterLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "llvm" }),
      ],
    }),
  },
  native: [sources({ dir: "native", header: "native/Greeter.h" })],
});
