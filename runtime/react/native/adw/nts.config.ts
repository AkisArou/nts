// react-gtk's libadwaita widgets, driven directly on real widgets: a Linux
// program beside native/gtk, which links GTK only. It shares that driver's
// shim, whose declarations (native/gtk/types) bring its sources with them.
import { defineConfig, app } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    host: app.linux({ entry: "./src/main.ts", backend: "c" }),
    // The same program through LLVM, checked against the same log.
    "host-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4", "libadwaita-1"] },
  },
});
