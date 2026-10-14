// A project's own Swift, compiled, and bound from the header Swift writes for
// it. Run on the lane's Mac against the same program in Swift.
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
  native: [sources({ dir: "native/Greeter" })],
});
