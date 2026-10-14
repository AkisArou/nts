// A UIKit application, on the iOS simulator. Run on the lane's Mac.
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    nav: app({
      kind: "application",
      id: "dev.nts.examples.ios-nav",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "c" })],
    }),
    // The same application through the LLVM backend.
    navLlvm: app({
      kind: "application",
      id: "dev.nts.examples.ios-nav-llvm",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
});
