// A Workbench demo, ported: see src/main.ts and tooling/gjs-corpus.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    demo: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "demo-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4", "libadwaita-1"] },
  },
});
