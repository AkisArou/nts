import {defineConfig, app} from "@nts/config";
export default defineConfig({
  products: {
    c: app.linux({entry: "./src/main.ts", backend: "c"}),
    llvm: app.linux({entry: "./src/main.ts", backend: "llvm"}),
  },
  dependencies: {"linux-gnu": {from: "pkg-config", packages: ["gtk4"]}},
});
