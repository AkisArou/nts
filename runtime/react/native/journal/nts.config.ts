// DESIGN.md's Journal app, rendered by React on real GTK widgets: a Linux
// GTK4 executable, through the C and the LLVM backends, with the React
// Compiler stage memoizing its components.
// The config package by path: this program is outside the examples workspace
// that resolves `@nts/config` by name.
import { defineConfig, app } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    journal: app.linux({ entry: "./src/main.tsx", backend: "c" }),
    "journal-llvm": app.linux({ entry: "./src/main.tsx", backend: "llvm" }),
  },
  react: {
    compiler: true,
    compilationMode: "infer",
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
