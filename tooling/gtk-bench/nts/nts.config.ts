// The nts half of the GTK benchmark against GJS (see ../run.sh).
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    bench: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
