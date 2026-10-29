// Records by value on arm64, through both backends, run under qemu's user mode
// on this x86_64 machine. The target selects static musl and bundled libuv.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    records: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", libc: "musl", backend: "c" })] }),
    recordsLlvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", libc: "musl", backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
