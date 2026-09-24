// A window with a button whose action is a TypeScript closure, on macOS. Run on
// the lane's Mac, in its GUI session.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    window: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same window through the LLVM backend, linked by `nts build` with the
    // C runtime, main and host units, as the C product is.
    windowLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
