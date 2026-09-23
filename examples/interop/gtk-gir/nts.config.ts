// A GTK4 executable on bindings generated from GIR. `sources` compiles the
// small shim; gtk4 arrives through pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    gir: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
