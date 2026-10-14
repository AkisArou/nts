// A GTK program whose signal handlers capture their own widgets, run under
// reference counting. `sources` compiles the shim; gtk4 arrives through
// pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    cycles: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
