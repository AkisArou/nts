// A notes application in AppKit, as Swift writes one, on macOS. Run on the
// lane's Mac, in its GUI session.
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    notes: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
    // The same application through the LLVM backend.
    notesLlvm: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "llvm" })],
    }),
  },
});
