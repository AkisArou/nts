// A libadwaita application, as GJS writes one, on both backends: the same
// program as a C and an LLVM product. gtk4 and libadwaita arrive through
// pkg-config, and their bindings from GIR.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    adw: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "adw-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4", "libadwaita-1"] },
  },
});
