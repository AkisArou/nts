// The one program the test embedder links: the witnesses and the benchmark
// workloads, compiled against the DOM surface in ../../dom. Outside the pnpm
// examples workspace, like react/native/gtk.
import { defineConfig, library, sources, target } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    probe: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./main.ts",
    }),
    "probe-llvm": library.staticNative({
      targets: [target.linux({ backend: "llvm" })],
      entry: "./main.ts",
    }),
  },
  native: [sources({ dir: "../../dom/abi" })],
});
