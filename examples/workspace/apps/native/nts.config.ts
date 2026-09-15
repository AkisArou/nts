// A plain CLI executable. No UI host at all.
//
// Here because every other app carries a `host`, and this one proves the field
// is optional rather than merely defaulted. The narrowest real artifact this
// compiler could produce today.
import { defineConfig, app, target } from "@native-typescript/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    cli: app({
      entry: "./src/main.ts",
      target: target.linux({ backend: "c" }),
      runtime: { family: "native", memory: { provider: "rc" } },
      // No `host`.
    }),
  },
});
