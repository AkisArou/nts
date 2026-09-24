// TypeScript closures as Objective-C blocks, on macOS. Run on the lane's Mac
// against an Objective-C oracle compiled with ARC.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    blocks: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same program through the LLVM backend, linked by `nts build` with
    // the C runtime, main and host units, as the C product is.
    blocksLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
