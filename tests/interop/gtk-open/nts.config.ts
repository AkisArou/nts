// An application that opens files: `GApplication::open`'s handler takes the
// files as one array, on bindings generated from GIR, as a C and an LLVM
// product; gio arrives through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    open: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "open-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gio-2.0"] },
  },
});
