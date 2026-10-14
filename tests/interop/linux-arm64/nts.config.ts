// One program for Linux on arm64, through both backends, run under qemu's
// user mode on this x86_64 machine. `build.sh` builds it with `CC` set to
// `tooling/linux/cc-musl.sh` (static, against musl: qemu has no arm64 glibc
// here to load a dynamic program with).
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    arm64: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", backend: "c" })] }),
    arm64Llvm: app({ kind: "executable", entry: "./src/main.ts", targets: [target.linux({ arch: "aarch64", backend: "llvm" })] }),
  },
  native: [sources({ dir: "native" })],
});
