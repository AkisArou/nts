// A Node addon. The C backend with `--napi`, which is real today.
//
// **The app that is a library to its host.** `node` and `native` share a target
// family and differ in artifact kind, which is the pair showing why those two
// axes cannot be merged: same machine, same backend, different thing produced.
import { defineConfig, library, target } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    addon: library({
      entry: "./src/main.ts",
      kind: "node-addon",
      target: target.node({ backend: "c" }),
      runtime: { family: "native", memory: { provider: "rc" } },
      exports: ["digest", "putRecord"],
    }),
  },
});
