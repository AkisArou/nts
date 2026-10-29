// One program for Linux on arm64, through both backends, run under qemu's
// user mode on this x86_64 machine. The target selects static musl and
// bundled libuv; neither an opaque CC wrapper nor a lane archive participates.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    arm64: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", libc: "musl", backend: "c" })] }),
    arm64Llvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", libc: "musl", backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
