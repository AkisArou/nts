import {
  defineConfig,
  library,
  memory,
} from "@native-typescript/config";

export default defineConfig({
  workspace: {
    root: ".",
    tsconfig: "./tsconfig.json",
  },

  products: {
    // The first vertical slice (RFC §40): a native shared library, no UI, no
    // platform toolchain. RC-cycle is the shipping provider; NoGC is available
    // for bring-up but never by default.
    hello: library({
      entry: "./src/main.ts",
      kind: "shared",
      runtimeLinkage: "bundled-private",
      target: { os: "linux", arch: "x86_64", backend: "c" },
      runtime: { family: "native", memory: memory.rcCycle() },
      exports: ["add", "greeting"],
    }),
  },
});
