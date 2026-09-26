// An application's actions, menu, accelerators and style, as a GTK
// application writes them, on bindings generated from GIR; the same program
// as a C and an LLVM product. gtk4 arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    actions: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "actions-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
