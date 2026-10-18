import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    desktop: app({ kind: "executable", entry: "./src/main.ts", targets: [target.windows({ arch: "x86_64", backend: "c" })] }),
    desktopLlvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.windows({ arch: "x86_64", backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
