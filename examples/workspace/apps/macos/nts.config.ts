// macOS. The same backend and the same source as iOS; a different host, a
// different minimum, and a different artifact kind at the end of it.
import { defineConfig, app, host, memory } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app.macos({
      entry: "./src/main.ts",
      minimumVersion: "14.0",
      runtime: { family: "native", memory: memory.rcCycle() },
      host: host.macos(),
    }),
  },
});
