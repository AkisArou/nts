// Foundation classes as TypeScript classes, on macOS. Run on the lane's Mac
// against an Objective-C oracle.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    classes: app({
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
