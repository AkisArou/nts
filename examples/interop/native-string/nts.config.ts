// A static archive with the package's own C in it, and a C program that
// links it. The shape every other C interop example here has.
import { defineConfig, library, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    lib: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
  native: [sources({ dir: "native" })],
});
