// DESIGN.md's state: a function component's useState, rendered by React on real GTK widgets.
import { defineConfig, app } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    state: app.linux({ entry: "./src/main.tsx", backend: "c" }),
    "state-llvm": app.linux({ entry: "./src/main.tsx", backend: "llvm" }),
  },
  react: {
    compiler: true,
    compilationMode: "infer",
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
