// GObject subclasses written in TypeScript, on both backends: the same
// program as a C and an LLVM product. gtk4 arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    subclass: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "subclass-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
