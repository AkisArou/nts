import { defineConfig, library, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    c: library.staticNative({
      entry: "./src/main.ts",
      targets: [target.linux({ backend: "c" })],
    }),
    llvm: library.staticNative({
      entry: "./src/main.ts",
      targets: [target.linux({ backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
