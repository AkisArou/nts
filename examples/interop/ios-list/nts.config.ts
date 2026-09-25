// A UIKit application, on the iOS simulator. Run on the lane's Mac.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    list: app({
      kind: "application",
      id: "dev.nts.examples.ios-list",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "c" })],
    }),
    // The same application through the LLVM backend.
    listLlvm: app({
      kind: "application",
      id: "dev.nts.examples.ios-list-llvm",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
