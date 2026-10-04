// DESIGN.md's counter, rendered by React on real GTK widgets.
import { defineConfig, app } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    counter: app.linux({ entry: "./src/main.tsx", backend: "c" }),
    "counter-llvm": app.linux({ entry: "./src/main.tsx", backend: "llvm" }),
  },
  react: {
    compiler: true,
    compilationMode: "infer",
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
