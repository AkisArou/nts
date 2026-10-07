// The one program the test embedder links: the witnesses and the benchmark
// workloads. target.chromium() types it against the DOM surface (nts:dom, and
// lib.dom bound to it) and links the DOM's native half. Outside the pnpm
// examples workspace, like react/native/gtk.
import { defineConfig, library, target } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    probe: library.staticNative({
      targets: [target.chromium({ backend: "c" })],
      entry: "./main.ts",
    }),
    "probe-llvm": library.staticNative({
      targets: [target.chromium({ backend: "llvm" })],
      entry: "./main.ts",
    }),
  },
});
