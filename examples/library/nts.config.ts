import { defineConfig, library, memory } from "@nts/config";

export default defineConfig({
  // `tsconfig` defaults to `./tsconfig.json` beside this file, so the line that
  // used to say exactly that is gone.
  workspace: { root: "." },

  products: {
    // The first vertical slice (RFC §40): a native shared library, no UI, no
    // platform toolchain. RC-cycle is the shipping provider; NoGC is available
    // for bring-up but never by default.
    //
    // `library.linux` rather than `library({ kind: "shared", target: {...} })`:
    // the target, the backend and `pkgConfig` come from the constructor, and
    // fields that mean nothing here -- `javaPackage`, `moduleName` -- are not
    // expressible rather than merely unused.
    hello: library.linux({
      entry: "./src/main.ts",
      runtimeLinkage: "bundled-private",
      runtime: { memory: memory.rcCycle() },
      exports: ["add", "greeting"],
    }),
  },
});
