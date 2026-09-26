// A GTK4 executable on bindings generated from GIR, in TypeScript only;
// gtk4 arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    gir: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
