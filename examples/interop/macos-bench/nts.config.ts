// Swift's surface timed against Swift itself, on the lane's Mac
// (bench.sh, never the gate: a timing is not a pass or a fail).
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    bench: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
  },
  native: [sources({ dir: "native" })],
});
