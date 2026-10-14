// Windows. LLVM backend, Win32 host.
//
// The target with no POSIX, and the one where `notifications` has no real
// binding story at all -- WinRT is neither C nor a class file. See
// `packages/notifications/native/windows/scheduler.h`.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app.windows({
      entry: "./src/main.ts",
    }),
  },
});
