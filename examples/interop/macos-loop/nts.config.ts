// A macOS executable whose loop is the main CFRunLoop. It links CoreFoundation,
// so it gets the run-loop host (`nts_cf_host`) as a Cocoa program does.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    loop: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
  },
  native: [sources({ dir: "native" })],
});
