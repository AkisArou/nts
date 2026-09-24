// A Win32 window from TypeScript, built here and run on the lane's Windows.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    window: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.windows({ arch: "x86_64", backend: "c" })],
    }),
    // The same program through the LLVM backend. A product of its own because
    // a build directory is named for the target, not the backend.
    windowLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.windows({ arch: "x86_64", backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
