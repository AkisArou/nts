// iOS. LLVM backend, UIKit host.
//
// Same backend as macOS and a different host, which is the pair that shows host
// is its own axis rather than a consequence of the target.
import { defineConfig, app, target, host, memory } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app({
      entry: "./src/main.ts",
      id: "dev.example.workspace",
      target: target.ios({ backend: "llvm", minimumVersion: "17.0" }),
      runtime: { family: "native", memory: memory.rcCycle({ cycleCollection: "incremental" }) },
      host: host.ios({ scheduler: "dispatch-main", fetch: "url-session", ui: "uikit" }),
    }),
  },
});
