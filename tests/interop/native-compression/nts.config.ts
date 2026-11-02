import { app, defineConfig, target } from "@nts/config";
export default defineConfig({
  products: {
    c: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ backend: "c" })] }),
    llvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ backend: "llvm" })] }),
  },
});
