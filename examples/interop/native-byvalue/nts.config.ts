// Records by value across the C boundary, checked against the same program
// written in C.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    byvalue: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.linux({ backend: "c" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
