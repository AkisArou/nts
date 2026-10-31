import {defineConfig, app} from "@nts/config";
export default defineConfig({products: {
  c: app.linux({entry: "./src/main.ts", backend: "c"}),
  llvm: app.linux({entry: "./src/main.ts", backend: "llvm"}),
  privateC: app.linux({entry: "./private/src/main.ts", backend: "c"}),
  privateLlvm: app.linux({entry: "./private/src/main.ts", backend: "llvm"}),
}});
