import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    enumtags: app({ kind: "executable", entry: "./src/main.ts", targets: [target.windows({ arch: "x86_64", backend: "c" })] }),
    enumtagsLlvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.windows({ arch: "x86_64", backend: "llvm" })] }),
  },
});
