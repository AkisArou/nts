// A libadwaita journal: GTK, libadwaita and cairo on bindings generated from
// GIR, in TypeScript only, as a C and an LLVM product -- the M4 application
// raced against its GJS twin (tooling/gtk-bench/gjs/journal.js).
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    journal: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "journal-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4", "libadwaita-1"] },
  },
});
