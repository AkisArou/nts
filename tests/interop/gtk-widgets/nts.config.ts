// Widgets and patterns every GTK application uses, on bindings generated
// from GIR; the same program as a C and an LLVM product. gtk4 arrives
// through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    widgets: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "widgets-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
