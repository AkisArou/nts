// A small notes application: GTK on bindings generated from GIR, the way
// GJS writes one. `sources` compiles the one-function shim; gtk4 arrives
// through pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    notes: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
