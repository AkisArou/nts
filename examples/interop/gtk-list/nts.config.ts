// A list view over a model, as a GTK application writes one: GTK on
// bindings generated from GIR. `sources` compiles the one-function shim;
// gtk4 arrives through pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    list: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
