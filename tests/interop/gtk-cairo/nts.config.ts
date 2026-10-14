// Drawing with cairo, as a GTK application draws: GTK and cairo on bindings
// generated from GIR -- cairo's the binder's own, with its drawing API -- as
// a C and an LLVM product. gtk4 arrives through pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    cairo: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "cairo-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
