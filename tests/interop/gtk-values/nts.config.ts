// GTK handles held where any value may go, on both backends: the same program
// as a C and an LLVM product. gtk4 arrives through pkg-config.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    values: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "values-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
