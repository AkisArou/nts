// iOS. LLVM backend, UIKit host.
//
// Same backend as macOS and a different host, which is the pair that shows host
// is its own axis rather than a consequence of the target.
import { defineConfig, app, memory } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app.ios({
      entry: "./src/main.ts",
      id: "dev.example.workspace",
      minimumVersion: "17.0",
      runtime: { memory: memory.rcCycle({ cycleCollection: "incremental" }) },
    }),
  },
});
