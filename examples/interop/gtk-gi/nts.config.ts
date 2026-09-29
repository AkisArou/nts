// GTK through the `gi:` surface, as a C and an LLVM product; gtk4 arrives
// through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    gi: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "gi-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
