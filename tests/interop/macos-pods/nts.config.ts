// A pod the program uses: `objc:Chirp`, bound from its public headers and
// compiled from the sources `pod install` left. Run on the lane's Mac against
// the same program in Objective-C.
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    chirp: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same program through the LLVM backend.
    chirpLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "llvm" }),
      ],
    }),
  },
  // CocoaPods' resolved output, beside the Pods/ it checked out.
  dependencies: {
    "macos-13": { from: "cocoapods", lockfile: "./Podfile.lock" },
  },
});
