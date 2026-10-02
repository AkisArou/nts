// Async signal handlers on GLib's loop, as a C and an LLVM product; gtk4 arrives
// through pkg-config.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    async: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "async-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
  // What `gi:gtk` is: the newest installed when absent.
  gi: { gtk: "4.0" },
});
