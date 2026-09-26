// A list view over a model, as a GTK application writes one: GTK on
// bindings generated from GIR, in TypeScript only; gtk4 arrives through
// pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    list: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
