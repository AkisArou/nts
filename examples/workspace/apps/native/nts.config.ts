// A plain CLI executable. No UI host at all.
//
// Here because every other app carries a `host`, and this one proves the field
// is optional rather than merely defaulted. The narrowest real artifact this
// compiler could produce today.
import { defineConfig, app, memory } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    cli: app.cli({
      entry: "./src/main.ts",
      backend: "c",
      runtime: { memory: memory.rcCycle() },
      // No `host`: `app.cli` does not accept one.
    }),
  },
});
