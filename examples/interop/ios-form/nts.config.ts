// A UIKit application, on the iOS simulator. Run on the lane's Mac.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    form: app({
      kind: "application",
      id: "dev.nts.examples.ios-form",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "c" })],
    }),
    // The same application through the LLVM backend.
    formLlvm: app({
      kind: "application",
      id: "dev.nts.examples.ios-form-llvm",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
