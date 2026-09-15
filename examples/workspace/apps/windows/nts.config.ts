// Windows. LLVM backend, Win32 host.
//
// The target with no POSIX, and the one where `notifications` has no real
// binding story at all -- WinRT is neither C nor a class file. See
// `packages/notifications/native/windows/scheduler.h`.
import { defineConfig, app, target, host, memory } from "@native-typescript/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app({
      entry: "./src/main.ts",
      target: target.windows({ backend: "llvm" }),
      runtime: { family: "native", memory: memory.rcCycle() },
      host: host.win32({ ui: "win32" }),
    }),
  },
});
