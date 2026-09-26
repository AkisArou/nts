// A UIKit application, on the iOS simulator. Run on the lane's Mac.
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    hello: app({
      kind: "application",
      id: "dev.nts.examples.ios-hello",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "c" })],
    }),
    // The same application through the LLVM backend.
    helloLlvm: app({
      kind: "application",
      id: "dev.nts.examples.ios-hello-llvm",
      entry: "./src/main.ts",
      targets: [target.ios({ minimumVersion: "17.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
});
