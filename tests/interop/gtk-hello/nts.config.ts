// A GTK4 executable. `app.linux` is the GTK host by construction, per
// tooling/config/src/product.ts; GTK itself arrives through pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    hello: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
