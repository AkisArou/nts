// List views over models, as a GTK application writes them: GTK on bindings
// generated from GIR, in TypeScript only, as a C and an LLVM product; gtk4
// arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    list: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "list-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
