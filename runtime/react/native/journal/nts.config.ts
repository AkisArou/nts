// DESIGN.md's Journal app, rendered by React on real GTK widgets: a Linux
// GTK4 executable through the C and the LLVM backends, and its libadwaita
// twin, with the React Compiler stage memoizing their components.
// The config package by path: this program is outside the examples workspace
// that resolves `@nts/config` by name.
import { defineConfig, app } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    journal: app.linux({ entry: "./src/main.tsx", backend: "c" }),
    "journal-llvm": app.linux({ entry: "./src/main.tsx", backend: "llvm" }),
    // The same app on libadwaita (AdwJournal.tsx).
    "journal-adw": app.linux({ entry: "./src/adw.tsx", backend: "c" }),
  },
  react: {
    compiler: true,
    compilationMode: "infer",
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4", "libadwaita-1"] },
  },
});
