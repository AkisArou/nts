// A GtkTextBuffer whose last use comes before its iterators' (see src/main.ts).
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    lifetime: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "lifetime-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
