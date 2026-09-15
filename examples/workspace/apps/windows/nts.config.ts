// Windows. LLVM backend, Win32 host.
//
// The target with no POSIX, and the one where `notifications` has no real
// binding story at all -- WinRT is neither C nor a class file. See
// `packages/notifications/native/windows/scheduler.h`.
import { defineConfig, app, host, memory } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app.windows({
      entry: "./src/main.ts",
      runtime: { family: "native", memory: memory.rcCycle() },
      host: host.win32({ ui: "win32" }),
    }),
  },
});
