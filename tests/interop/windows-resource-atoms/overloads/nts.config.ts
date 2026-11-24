import { defineConfig, library, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    host: library.staticNative({ prefix: "lib", entry: "./src/main.ts", targets: [target.linux({ backend: "c" })] }),
    hostLlvm: library.staticNative({ prefix: "lib", entry: "./src/main.ts", targets: [target.linux({ backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
