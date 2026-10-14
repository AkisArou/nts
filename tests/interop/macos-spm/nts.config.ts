// Swift packages the program uses: `objc:Tally`, an Objective-C target, and
// `objc:Blink`, a Swift one, read from the Package.swift here and compiled.
// Run on the lane's Mac against the same program in Objective-C.
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    spm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same program through the LLVM backend.
    spmLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "llvm" }),
      ],
    }),
  },
  // SwiftPM's resolved output, beside the Package.swift it pins. Both
  // packages here are local, which SwiftPM pins nothing for.
  dependencies: {
    "macos-13": { from: "swiftpm", lockfile: "./Package.resolved" },
  },
});
