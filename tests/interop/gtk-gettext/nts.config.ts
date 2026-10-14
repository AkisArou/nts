// GJS's `gettext` module on both backends: the same program as a C and an
// LLVM product. GLib arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    gettext: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "gettext-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["glib-2.0"] },
  },
});
