// Records by value on arm64, through both backends, run under qemu's user mode
// on this x86_64 machine. `build.sh` builds with `CC` set to
// `tooling/linux/cc-musl.sh`, as `linux-arm64` does: static, against musl.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    records: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", backend: "c" })] }),
    recordsLlvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
