// A program that awaits promises a foreign function answers, through both
// backends.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    promise: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ backend: "c" })] }),
    promiseLlvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
