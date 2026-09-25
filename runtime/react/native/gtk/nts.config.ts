// react-gtk's host config, driven directly on real GTK widgets: a Linux GTK4
// executable. GTK arrives through pkg-config; the shim is what the generated
// bindings cannot reach (native/shim.h).
// The config package by path: this program is outside the examples workspace
// that resolves `@nts/config` by name.
import { defineConfig, app, sources } from "../../../../tooling/config/src/index.ts";

export default defineConfig({
  products: {
    host: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
