// This experiment is outside the pnpm examples workspace, like react/native/gtk.
import { defineConfig, library, sources, target } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    probe: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
    "probe-llvm": library.staticNative({
      targets: [target.linux({ backend: "llvm" })],
      entry: "./src/main.ts",
    }),
  },
  native: [sources({ dir: "native/ffi" })],
});
