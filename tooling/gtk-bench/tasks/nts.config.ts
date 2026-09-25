// The task list the benchmark runs against GJS (see ../run.sh and
// ../gjs/tasks.js): an application whose time is its own code, not GTK's.
import { defineConfig, app, sources } from "@nts/config";

export default defineConfig({
  products: {
    tasks: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  native: [sources({ dir: "native" })],
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
