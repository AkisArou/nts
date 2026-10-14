// A small notes application: GTK on bindings generated from GIR, the way
// GJS writes one, in TypeScript only; gtk4 arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    notes: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
