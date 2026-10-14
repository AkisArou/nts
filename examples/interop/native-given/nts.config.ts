// Dictionary members C is told were given or not, checked against the same
// program written in C.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    given: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.linux({ backend: "c" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
