// One program, three machines: the Linux host, and Windows on both arches.
//
// The Linux build is the reference. The Windows builds are cross-compiled here
// (mingw ABI, through zig) and run on the lane's VM (`tooling/windows/run.sh`);
// what they print must be byte-identical to what Linux printed. aarch64 only
// links: there is no arm64 Windows to run it on, and that gap is written down.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    hello: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [
        target.linux({ backend: "c" }),
        target.windows({ arch: "x86_64", backend: "c" }),
        target.windows({ arch: "aarch64", backend: "c" }),
      ],
    }),
  },
  native: [sources({ dir: "native" })],
});
