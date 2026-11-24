import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    c: library.staticNative({ prefix: "lib",entry: "./src/main.ts", targets: [target.linux({backend: "c"})]}),
    llvm: library.staticNative({ prefix: "lib",entry: "./src/main.ts", targets: [target.linux({backend: "llvm"})]}),
  },
});
