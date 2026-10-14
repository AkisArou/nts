// One program, three machines: the Linux host, and macOS on both arches.
//
// The Linux build is the reference. The macOS builds are cross-compiled here
// and run on a Mac (or the lane's VM, `tooling/apple/run.sh`); what they print
// must be byte-identical to what Linux printed. aarch64 only links unless an
// arm64 Mac is reachable -- that gap is written down, not hidden.
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    hello: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.linux({ backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "x86_64", backend: "c" }),
        target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "c" }),
      ],
    }),
  },
});
